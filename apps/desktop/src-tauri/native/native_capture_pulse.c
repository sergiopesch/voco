#define _POSIX_C_SOURCE 200809L
#include "native_capture_pulse.h"
#include <pulse/pulseaudio.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
struct vc_slot  {
    uint8_t bytes[VC_BLOCK_BYTES];
    size_t length;
    uint64_t sequence, start;
};
struct vc_pulse  {
    pa_mainloop *loop;
    pa_context *context;
    pa_stream *stream;
    pa_operation *operations[32];
    vc_catalog catalog;
    vc_source selected;
    vc_status status;
    struct vc_slot slots[VC_SLOTS];
    uint64_t produced, consumed, exposed_through;
    uint64_t started_ms, stop_ms;
    uint32_t cookie;
    bool context_ready, subscribed, listing, list_done, server_done, selected_verified;
    bool starting, stopping, active, recheck, server_recheck;
};
static uint64_t now_ms(void)  {
    struct timespec t;
    if (clock_gettime(CLOCK_MONOTONIC,&t)) return 0;
    return (uint64_t)t.tv_sec*1000+(uint64_t)t.tv_nsec/1000000;
}
static bool copy_text(char *dst,size_t cap,const char *src)  {
    if(!src || strlen(src)>=cap)return false;
    memcpy(dst,src,strlen(src)+1);
    return true;
}
static void fail(vc_pulse *p,const char *reason)  {
    if(!p->status.error[0])copy_text(p->status.error,sizeof p->status.error,reason);
}
/* References are retained until completion or explicit cancellation. Pulse's
 * operation.h guarantees cancellation suppresses future client callbacks. */
static void clear_operations(vc_pulse *p, bool cancel) {
    for (size_t n = 0; n < 32; n++) {
        pa_operation *op = p->operations[n];
        if (!op) continue;
        if (cancel || pa_operation_get_state(op) != PA_OPERATION_RUNNING) {
            p->operations[n] = NULL;
            if (cancel) pa_operation_cancel(op);
            pa_operation_unref(op);
        }
    }
}
static void operation(vc_pulse *p, pa_operation *op) {
    if (!op) { fail(p, "operation-create-failed"); return; }
    clear_operations(p, false);
    for (size_t n = 0; n < 32; n++) {
        if (!p->operations[n]) { p->operations[n] = op; return; }
    }
    pa_operation_cancel(op); pa_operation_unref(op);
    fail(p, "operation-capacity-exceeded");
}
static void detach_stream(vc_pulse *p)  {
    clear_operations(p, true);
    pa_stream *s=p->stream;
    p->stream=NULL;
    if(s) {
        pa_stream_set_state_callback(s,NULL,NULL);
        pa_stream_set_read_callback(s,NULL,NULL);
        pa_stream_set_moved_callback(s,NULL,NULL);
        pa_stream_set_suspended_callback(s,NULL,NULL);
        pa_stream_set_overflow_callback(s,NULL,NULL);
        pa_stream_disconnect(s);
        pa_stream_unref(s);
    }
    p->active=false;
    p->starting=false;
}
/* All queue access is confined to the worker/mainloop thread. */
static bool queue_bytes(vc_pulse *p, const void *data, size_t size)  {
    if (!data || !size || size % 4 || size > VC_BLOCK_BYTES || p->status.frames > VC_MAX_FRAMES)  {
        fail(p, "invalid-block-extent");
        return false;
    }
    uint64_t remaining = VC_MAX_FRAMES - p->status.frames;
    size_t accepted = size;
    if ((uint64_t)(size / 4) > remaining) accepted = (size_t)remaining * 4;
    if (accepted)  {
        struct vc_slot *tail = NULL;
        size_t append = 0;
        if (p->produced > p->consumed && p->produced > p->exposed_through) {
            tail = &p->slots[(p->produced - 1) % VC_SLOTS];
            append = VC_BLOCK_BYTES - tail->length;
            if (append > accepted) append = accepted;
        }
        /* A callback touches at most this tail and one new slot. Reserve both
         * before copying: overflow must not retain just part of a callback. */
        if (accepted > append && p->produced - p->consumed >= VC_SLOTS)  {
            fail(p, "capture-queue-overflow");
            return false;
        }
        if (append) {
            memcpy(tail->bytes + tail->length, data, append);
            tail->length += append;
            p->status.frames += append / 4;
        }
        if (accepted > append) {
            struct vc_slot *slot = &p->slots[p->produced % VC_SLOTS];
            slot->length = accepted - append;
            memcpy(slot->bytes, (const uint8_t *)data + append, slot->length);
            slot->sequence = p->produced + 1;
            slot->start = p->status.frames;
            p->status.frames += slot->length / 4;
            p->produced++;
            p->status.blocks = p->produced;
        }
    }
    if (p->status.frames == VC_MAX_FRAMES) p->status.limit_reached = 1;
    return true;
}
static void read_available(vc_pulse *p)  {
    while(p->stream && !p->status.stopped && !p->status.error[0] && !p->status.limit_reached) {
        size_t available=pa_stream_readable_size(p->stream);
        if(available==(size_t)-1) {
            fail(p,"readable-failed");
            return;
        }
        if(!available)return;
        const void *data=NULL;
        size_t size=0;
        if(pa_stream_peek(p->stream,&data,&size)<0) {
            fail(p,"peek-failed");
            return;
        }
        if(!size)return;
        if(!data) {
            fail(p,"audio-hole");
            pa_stream_drop(p->stream);
            return;
        }
        if(!queue_bytes(p,data,size)) {
            pa_stream_drop(p->stream);
            return;
        }
        if(pa_stream_drop(p->stream)<0) {
            fail(p,"drop-failed");
            return;
        }
        if(p->status.frames==VC_MAX_FRAMES)p->status.limit_reached=1;
    }
}
static void read_cb(pa_stream *s,size_t bytes,void *data) {
    (void)s;
    (void)bytes;
    read_available(data);
}
static void overflow_cb(pa_stream *s,void *data) {
    (void)s;
    fail(data,"server-overflow");
}
static void moved_cb(pa_stream *s,void *data) {
    (void)s;
    fail(data,"source-moved");
}
static void suspended_cb(pa_stream *s,void *data) {
    vc_pulse*p=data;
    if(p->status.ready&&!p->stopping&&pa_stream_is_suspended(s)>0)fail(p,"source-suspended");
}
static void barrier_cb(pa_stream*s,int success,void*data) {
    (void)s;
    vc_pulse*p=data;
    if(!success)fail(p,"timing-barrier-failed");
    else p->status.barrier_ack=1;
    read_available(p);
    p->status.stopped=1;
}
static void cork_cb(pa_stream*s,int success,void*data) {
    vc_pulse*p=data;
    if(!success) {
        fail(p,"cork-failed");
        p->status.stopped=1;
        return;
    }
    p->status.cork_ack=1;
    read_available(p);
    operation(p,pa_stream_update_timing_info(s,barrier_cb,p));
}
static void uncork_cb(pa_stream*s,int success,void*data) {
    vc_pulse*p=data;
    if(!success) {
        fail(p,"uncork-failed");
        return;
    }
    if(pa_stream_is_suspended(s)>0) {
        fail(p,"source-suspended-at-start");
        return;
    }
    p->status.ready=1;
    p->starting=false;
}
static bool matches(vc_pulse*p,const pa_source_info*i) {
    const char*serial=i&&i->proplist?pa_proplist_gets(i->proplist,"object.serial"):NULL;
    return i&&i->name&&serial&&i->index==p->selected.index&&!strcmp(i->name,p->selected.name)&&!strcmp(serial,p->selected.serial);
}
static void verify_source(pa_context*c,const pa_source_info*i,int eol,void*data) {
    (void)c;
    vc_pulse*p=data;
    if(eol<0) {
        fail(p,"source-recheck-failed");
        return;
    }
    if(eol) {
        if(!p->selected_verified)fail(p,"source-missing");
        return;
    }
    if(!matches(p,i)) {
        fail(p,"source-identity-changed");
        return;
    }
    p->selected_verified=true;
    if(p->status.ready&&!p->stopping&&i->state==PA_SOURCE_SUSPENDED)fail(p,"source-suspended");
}
static void verify_before_uncork(pa_context*c,const pa_source_info*i,int eol,void*data) {
    verify_source(c,i,eol,data);
    vc_pulse*p=data;
    if(eol>0&&!p->status.error[0]&&!p->stopping&&p->stream)operation(p,pa_stream_cork(p->stream,0,uncork_cb,p));
}
static void stream_state(pa_stream*s,void*data) {
    vc_pulse*p=data;
    switch(pa_stream_get_state(s)) {
        case PA_STREAM_READY: {
            const pa_sample_spec*spec=pa_stream_get_sample_spec(s);
            const pa_channel_map*map=pa_stream_get_channel_map(s);
            const char*name=pa_stream_get_device_name(s);
            if(!spec||!map||spec->format!=PA_SAMPLE_S16LE||spec->rate!=44100||spec->channels!=2||map->channels!=2||map->map[0]!=PA_CHANNEL_POSITION_FRONT_LEFT||map->map[1]!=PA_CHANNEL_POSITION_FRONT_RIGHT||!name||strcmp(name,p->selected.name)||pa_stream_get_device_index(s)!=p->selected.index) {
                fail(p,"negotiated-source-or-format-mismatch");
                break;
            }
            p->selected_verified=false;
            operation(p,pa_context_get_source_info_by_index(p->context,p->selected.index,verify_before_uncork,p));
            break;
        }
        case PA_STREAM_FAILED:fail(p,"stream-failed");
        break;
        case PA_STREAM_TERMINATED:if(!p->status.stopped)fail(p,"stream-terminated");
        break;
        default:break;
    }
}
static void subscription(pa_context*c,pa_subscription_event_type_t event,uint32_t index,void*data) {
    (void)c;
    vc_pulse*p=data;
    unsigned facility=event&PA_SUBSCRIPTION_EVENT_FACILITY_MASK;
    p->catalog.revision++;
    if(p->active&&facility==PA_SUBSCRIPTION_EVENT_SOURCE&&index==p->selected.index) {
        if((event&PA_SUBSCRIPTION_EVENT_TYPE_MASK)==PA_SUBSCRIPTION_EVENT_REMOVE)fail(p,"source-removed");
        else p->recheck=true;
    }
    if(p->active&&facility==PA_SUBSCRIPTION_EVENT_SERVER)p->server_recheck=true;
}
static void subscribed(pa_context*c,int success,void*data) {
    (void)c;
    vc_pulse*p=data;
    if(success)p->subscribed=true;
    else fail(p,"subscription-failed");
}
static void context_state(pa_context*c,void*data) {
    vc_pulse*p=data;
    switch(pa_context_get_state(c)) {
        case PA_CONTEXT_READY:if(!p->context_ready) {
            p->context_ready=true;
            pa_context_set_subscribe_callback(c,subscription,p);
            operation(p,pa_context_subscribe(c,PA_SUBSCRIPTION_MASK_SOURCE|PA_SUBSCRIPTION_MASK_SERVER,subscribed,p));
        }
        break;
        case PA_CONTEXT_FAILED:case PA_CONTEXT_TERMINATED:fail(p,"audio-server-disconnected");
        break;
        default:break;
    }
}
static void server_info(pa_context*c,const pa_server_info*i,void*data) {
    (void)c;
    vc_pulse*p=data;
    if(!i) {
        fail(p,"server-info-failed");
        return;
    }
    if(p->active&&p->cookie!=i->cookie) {
        fail(p,"server-identity-changed");
        return;
    }
    p->cookie=i->cookie;
    if(!copy_text(p->catalog.default_name,sizeof p->catalog.default_name,i->default_source_name))p->catalog.default_name[0]=0;
    p->server_done=true;
}
static void source_info(pa_context*c,const pa_source_info*i,int eol,void*data) {
    (void)c;
    vc_pulse*p=data;
    if(eol<0) {
        fail(p,"source-list-failed");
        return;
    }
    if(eol) {
        p->list_done=true;
        return;
    }
    if(p->catalog.count==VC_SOURCE_CAP) {
        fail(p,"source-list-limit");
        return;
    }
    vc_source*s=&p->catalog.sources[p->catalog.count];
    memset(s,0,sizeof*s);
    const char*serial=i->proplist?pa_proplist_gets(i->proplist,"object.serial"):NULL;
    if(!copy_text(s->name,sizeof s->name,i->name)||!copy_text(s->label,sizeof s->label,i->description?i->description:i->name)|| (serial&&!copy_text(s->serial,sizeof s->serial,serial))) {
        fail(p,"source-text-limit");
        return;
    }
    s->index=i->index;
    s->monitor=i->monitor_of_sink!=PA_INVALID_INDEX;
    p->catalog.count++;
}
vc_pulse*vc_new(const char*socket_path) {
    vc_pulse*p=calloc(1,sizeof*p);
    if(!p)return NULL;
    p->catalog.revision=1;
    p->loop=pa_mainloop_new();
    if(!p->loop) {
        vc_free(p);
        return NULL;
    }
    p->context=pa_context_new(pa_mainloop_get_api(p->loop),"VOCO native capture development");
    if(!p->context) {
        vc_free(p);
        return NULL;
    }
    pa_context_set_state_callback(p->context,context_state,p);
    if(pa_context_connect(p->context,socket_path,PA_CONTEXT_NOAUTOSPAWN,NULL)<0)fail(p,"server-connect-failed");
    return p;
}
void vc_cancel(vc_pulse*p) {
    detach_stream(p);
    p->consumed=p->produced;
    if (!p->context || pa_context_get_state(p->context) != PA_CONTEXT_READY) fail(p, "audio-server-disconnected");
    /* A healthy cancelled recording does not revoke explicit device consent.
     * Never clear an interrupted source/server failure here. */
    if (!p->status.error[0]) memset(&p->status, 0, sizeof p->status);
    p->status.stopped=1;
    p->stopping=false;
    p->recheck=false;
    p->server_recheck=false;
}
void vc_free(vc_pulse*p) {
    if(!p)return;
    detach_stream(p);
    if(p->context) {
        pa_context_set_state_callback(p->context,NULL,NULL);
        pa_context_set_subscribe_callback(p->context,NULL,NULL);
        pa_context_disconnect(p->context);
        pa_context_unref(p->context);
    }
    if(p->loop)pa_mainloop_free(p->loop);
    free(p);
}
void vc_stop(vc_pulse*p) {
    if(p->stopping||p->status.stopped)return;
    p->stopping=true;
    p->stop_ms=now_ms();
    if(p->stream&&pa_stream_get_state(p->stream)==PA_STREAM_READY)operation(p,pa_stream_cork(p->stream,1,cork_cb,p));
    else {
        fail(p,"stopped-before-ready");
        p->status.stopped=1;
    }
}
void vc_tick(vc_pulse*p) {
    int result=0;
    if(pa_mainloop_iterate(p->loop,0,&result)<0)fail(p,"mainloop-failed");
    clear_operations(p, false);
    if(p->active&&p->recheck&&!p->stopping) {
        p->recheck=false;
        p->selected_verified=false;
        operation(p,pa_context_get_source_info_by_index(p->context,p->selected.index,verify_source,p));
    }
    if(p->active&&p->server_recheck&&!p->stopping) {
        p->server_recheck=false;
        operation(p,pa_context_get_server_info(p->context,server_info,p));
    }
    if(p->active&&(p->status.error[0]||p->status.limit_reached))vc_stop(p);
    if(p->starting&&now_ms()-p->started_ms>=5000) {
        fail(p,"startup-timeout");
        vc_stop(p);
    }
    if(p->stopping&&!p->status.stopped&&now_ms()-p->stop_ms>=3000) {
        fail(p,"stop-timeout");
        p->status.stopped=1;
    }
    if(p->status.stopped&&p->stream)detach_stream(p);
}
int vc_enumerate(vc_pulse*p,vc_catalog*out) {
    if(p->active)return -1;
    uint64_t until=now_ms()+5000;
    while(!p->subscribed&&!p->status.error[0]&&now_ms()<until) {
        vc_tick(p);
        struct timespec nap= {
            0,1000000
        };
        nanosleep(&nap,NULL);
    }
    if(!p->subscribed||p->status.error[0])return -1;
    p->catalog.count=0;
    p->list_done=false;
    p->server_done=false;
    operation(p,pa_context_get_server_info(p->context,server_info,p));
    operation(p,pa_context_get_source_info_list(p->context,source_info,p));
    while((!p->list_done||!p->server_done)&&!p->status.error[0]&&now_ms()<until) {
        vc_tick(p);
        struct timespec nap= {
            0,1000000
        };
        nanosleep(&nap,NULL);
    }
    if(!p->list_done||!p->server_done||p->status.error[0])return -1;
    *out=p->catalog;
    return 0;
}
int vc_begin(vc_pulse*p,const vc_source*source,uint64_t revision) {
    (void)revision;
    if(p->active||!p->subscribed||!source->serial[0]||p->status.error[0])return -1;
    memset(&p->status,0,sizeof p->status);
    p->produced=0;
    p->consumed=0;
    p->exposed_through=0;
    p->selected=*source;
    p->stopping=false;
    p->recheck=false;
    p->server_recheck=false;
    p->selected_verified=false;
    p->starting=true;
    p->active=true;
    p->started_ms=now_ms();
    pa_sample_spec spec= {
        PA_SAMPLE_S16LE,44100,2
    };
    pa_channel_map map;
    pa_channel_map_init_stereo(&map);
    p->stream=pa_stream_new(p->context,"VOCO explicitly selected microphone",&spec,&map);
    if(!p->stream) {
        fail(p,"stream-create-failed");
        return -1;
    }
    pa_stream_set_state_callback(p->stream,stream_state,p);
    pa_stream_set_read_callback(p->stream,read_cb,p);
    pa_stream_set_overflow_callback(p->stream,overflow_cb,p);
    pa_stream_set_moved_callback(p->stream,moved_cb,p);
    pa_stream_set_suspended_callback(p->stream,suspended_cb,p);
    pa_buffer_attr attrs= {
        .maxlength=VC_BLOCK_BYTES,.tlength=(uint32_t)-1,.prebuf=(uint32_t)-1,.minreq=(uint32_t)-1,.fragsize=1764
    };
    /* Apply fragsize to source latency too; server defaults can otherwise retain
     * seconds of audio beyond the bounded client buffer and the Stop barrier. */
    if(pa_stream_connect_record(p->stream,source->name,&attrs,PA_STREAM_START_CORKED|PA_STREAM_AUTO_TIMING_UPDATE|PA_STREAM_DONT_MOVE|PA_STREAM_ADJUST_LATENCY)<0) {
        fail(p,"record-connect-failed");
        return -1;
    }
    return 0;
}
void vc_get_status(vc_pulse*p,vc_status*out) {
    *out=p->status;
}
int vc_peek(vc_pulse*p,uint32_t offset,const uint8_t**bytes,size_t*length,uint64_t*sequence,uint64_t*frame_start) {
    if((uint64_t)offset>=p->produced-p->consumed)return 0;
    struct vc_slot*s=&p->slots[(p->consumed+offset)%VC_SLOTS];
    /* Once offered, bytes and extent stay immutable through ACK/cancel.
     * Counts were already updated by enqueue, before the worker's receipt. */
    if(s->sequence>p->exposed_through)p->exposed_through=s->sequence;
    *bytes=s->bytes;
    *length=s->length;
    *sequence=s->sequence;
    *frame_start=s->start;
    return 1;
}
int vc_ack(vc_pulse*p,uint32_t count) {
    if((uint64_t)count>p->produced-p->consumed)return -1;
    p->consumed+=count;
    return 0;
}
#ifdef VC_UNIT_TEST
#include <assert.h>
/* Test-only operation doubles. No Pulse connection or external object is used. */
struct pa_operation { pa_operation_state_t state; unsigned cancelled, released; };
pa_operation_state_t pa_operation_get_state(const pa_operation *op) { return op->state; }
void pa_operation_cancel(pa_operation *op) { op->cancelled++; op->state = PA_OPERATION_CANCELLED; }
void pa_operation_unref(pa_operation *op) { op->released++; }
int main(void)  {
    vc_pulse *p = calloc(1, sizeof *p);
    assert(p);
    uint8_t bytes[8] =  {
        1,2,3,4,5,6,7,8
    };
    for (unsigned round=0; round<3; ++round)  {
        for (unsigned i=0; i<VC_SLOTS; ++i) {
            const uint8_t *data;
            size_t length;
            uint64_t sequence,start;
            assert(queue_bytes(p,bytes,4));
            assert(vc_peek(p,i,&data,&length,&sequence,&start)==1);
        }
        assert(p->produced-p->consumed==VC_SLOTS);
        for (unsigned i=0; i<VC_SLOTS; ++i)  {
            const uint8_t *data;
            size_t length;
            uint64_t sequence,start;
            assert(vc_peek(p,0,&data,&length,&sequence,&start)==1);
            assert(length==4 && !memcmp(data,bytes,4));
            assert(sequence==(uint64_t)round*VC_SLOTS+i+1 && start==sequence-1);
            assert(vc_ack(p,1)==0);
        }
    }
    assert(vc_ack(p,1)==-1);
    for (unsigned i=0; i<VC_SLOTS; ++i) {
        const uint8_t *data;
        size_t length;
        uint64_t sequence,start;
        assert(queue_bytes(p,bytes,4));
        assert(vc_peek(p,i,&data,&length,&sequence,&start)==1);
    }
    uint64_t before=p->status.frames;
    assert(!queue_bytes(p,bytes,4));
    assert(p->status.frames==before);
    assert(!strcmp(p->status.error,"capture-queue-overflow"));
    memset(p,0,sizeof*p);
    p->status.frames=VC_MAX_FRAMES-1;
    assert(queue_bytes(p,bytes,8));
    assert(p->status.frames==VC_MAX_FRAMES && p->status.limit_reached);
    assert(p->slots[0].length==4 && !memcmp(p->slots[0].bytes,bytes,4));
    memset(p,0,sizeof*p);
    assert(!queue_bytes(p,bytes,3));
    assert(!p->produced);
    memset(p, 0, sizeof *p);
    struct pa_operation completed = { .state = PA_OPERATION_DONE };
    struct pa_operation pending = { .state = PA_OPERATION_RUNNING };
    operation(p, &completed); operation(p, &pending);
    assert(completed.released == 1 && completed.cancelled == 0);
    assert(pending.released == 0);
    detach_stream(p);
    assert(pending.cancelled == 1 && pending.released == 1);
    for (size_t n=0;n<32;n++) assert(p->operations[n] == NULL);
    detach_stream(p); assert(pending.released == 1);
    struct pa_operation many[33] = {0};
    for (size_t n=0;n<33;n++) { many[n].state = PA_OPERATION_RUNNING; operation(p, &many[n]); }
    assert(many[32].cancelled == 1 && many[32].released == 1);
    assert(!strcmp(p->status.error, "operation-capacity-exceeded"));
    detach_stream(p);
    for (size_t n=0;n<33;n++) assert(many[n].released == 1);
    free(p);
    return 0;
}
#endif
