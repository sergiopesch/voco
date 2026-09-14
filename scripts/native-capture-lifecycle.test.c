/* Actual production callback bodies; Pulse transport and monotonic clock doubled. */
#define _POSIX_C_SOURCE 200809L
#include <pulse/pulseaudio.h>
#include <assert.h>
#include <stdio.h>
#include <time.h>
static uint64_t fake_ms;
static int test_clock_gettime(clockid_t id, struct timespec *t) {
    assert(id == CLOCK_MONOTONIC);
    t->tv_sec = (time_t)(fake_ms / 1000);
    t->tv_nsec = (long)(fake_ms % 1000) * 1000000;
    return 0;
}
#define clock_gettime test_clock_gettime
#include "native_capture_pulse.c"
#undef clock_gettime

struct pa_operation {
    pa_operation_state_t state;
    pa_stream_success_cb_t callback;
    void *data;
    unsigned cancelled, released;
};
struct pa_stream { unsigned disconnected, released, callbacks_cleared; };
struct pa_context { pa_context_state_t state; };
static struct pa_stream stream;
static struct pa_context context;
static struct pa_operation ops[8];
static unsigned nops, cork_calls, timing_calls, drops;
static const void *incoming;
static size_t incoming_bytes;
static bool reject_operation;

pa_operation_state_t pa_operation_get_state(const pa_operation *o) { return o->state; }
void pa_operation_cancel(pa_operation *o) { assert(!o->cancelled); o->cancelled++; o->state=PA_OPERATION_CANCELLED; }
void pa_operation_unref(pa_operation *o) { assert(!o->released); o->released++; }
static pa_operation *make_op(pa_stream_success_cb_t cb, void *data) {
    if(reject_operation) return NULL;
    assert(nops < 8);
    pa_operation *o=&ops[nops++]; o->state=PA_OPERATION_RUNNING; o->callback=cb; o->data=data; return o;
}
pa_operation *pa_stream_cork(pa_stream *s,int cork,pa_stream_success_cb_t cb,void *data) {
    assert(s==&stream && cork==1); cork_calls++; return make_op(cb,data);
}
pa_operation *pa_stream_update_timing_info(pa_stream *s,pa_stream_success_cb_t cb,void *data) {
    assert(s==&stream); timing_calls++; return make_op(cb,data);
}
pa_stream_state_t pa_stream_get_state(const pa_stream *s) { assert(s==&stream); return PA_STREAM_READY; }
int pa_stream_is_suspended(const pa_stream *s) { assert(s==&stream); return 0; }
size_t pa_stream_readable_size(const pa_stream *s) { assert(s==&stream); return incoming_bytes; }
int pa_stream_peek(pa_stream *s,const void **data,size_t *size) { assert(s==&stream); *data=incoming; *size=incoming_bytes; return 0; }
int pa_stream_drop(pa_stream *s) { assert(s==&stream && incoming_bytes); incoming_bytes=0; drops++; return 0; }
int pa_stream_disconnect(pa_stream *s) { assert(s==&stream && !s->disconnected); s->disconnected++; return 0; }
void pa_stream_unref(pa_stream *s) { assert(s==&stream && !s->released); s->released++; }
#define CLEAR_CALLBACK(name,type) void name(pa_stream *s,type cb,void *data) { assert(s==&stream && !cb && !data); s->callbacks_cleared++; }
CLEAR_CALLBACK(pa_stream_set_state_callback,pa_stream_notify_cb_t)
CLEAR_CALLBACK(pa_stream_set_read_callback,pa_stream_request_cb_t)
CLEAR_CALLBACK(pa_stream_set_moved_callback,pa_stream_notify_cb_t)
CLEAR_CALLBACK(pa_stream_set_suspended_callback,pa_stream_notify_cb_t)
CLEAR_CALLBACK(pa_stream_set_overflow_callback,pa_stream_notify_cb_t)
int pa_mainloop_iterate(pa_mainloop *m,int block,int *retval) { (void)m; assert(!block); *retval=0; return 0; }
pa_context_state_t pa_context_get_state(const pa_context *c) { assert(c==&context); return c->state; }
pa_operation *pa_context_get_source_info_by_index(pa_context *c,uint32_t index,pa_source_info_cb_t cb,void *data) {
    (void)c;(void)index;(void)cb;(void)data; assert(!"unexpected source recheck"); return NULL;
}
pa_operation *pa_context_get_server_info(pa_context *c,pa_server_info_cb_t cb,void *data) {
    (void)c;(void)cb;(void)data; assert(!"unexpected server recheck"); return NULL;
}
const char *pa_proplist_gets(const pa_proplist *p,const char *key) { (void)p;(void)key; assert(!"unexpected property query"); return NULL; }
void pa_context_set_subscribe_callback(pa_context *c,pa_context_subscribe_cb_t cb,void *data) { (void)c;(void)cb;(void)data; assert(!"unexpected subscription setup"); }
pa_operation *pa_context_subscribe(pa_context *c,pa_subscription_mask_t mask,pa_context_success_cb_t cb,void *data) { (void)c;(void)mask;(void)cb;(void)data; assert(!"unexpected subscription setup"); return NULL; }

static vc_pulse *fresh(void) {
    memset(&stream,0,sizeof stream); memset(ops,0,sizeof ops);
    nops=cork_calls=timing_calls=drops=0; incoming=NULL; incoming_bytes=0; reject_operation=false; fake_ms=10000;
    context.state=PA_CONTEXT_READY;
    vc_pulse *p=calloc(1,sizeof *p); assert(p);
    p->stream=&stream; p->context=&context; p->active=true; p->status.ready=1; p->selected.index=62; p->cookie=42;
    return p;
}
static void deliver(vc_pulse *p,unsigned value) {
    static uint8_t packet[1764]; memset(packet,(int)value,sizeof packet);
    incoming=packet; incoming_bytes=sizeof packet; read_cb(&stream,sizeof packet,p);
}
static void complete(unsigned index,int success) {
    assert(index<nops); pa_operation *o=&ops[index]; assert(o->state==PA_OPERATION_RUNNING && !o->cancelled);
    o->state=PA_OPERATION_DONE; o->callback(&stream,success,o->data);
}
static void prefix(vc_pulse *p,unsigned count) {
    assert(p->status.blocks==count && p->status.frames==(uint64_t)count*441);
    for(unsigned i=0;i<count;i++) {
        const uint8_t *data; size_t length; uint64_t seq,start;
        assert(vc_peek(p,0,&data,&length,&seq,&start)==1);
        assert(length==1764 && seq==i+1 && start==(uint64_t)i*441);
        for(size_t n=0;n<length;n++) assert(data[n]==(uint8_t)(i+1));
        assert(vc_ack(p,1)==0);
    }
    const uint8_t *data; size_t length; uint64_t seq,start;
    assert(vc_peek(p,0,&data,&length,&seq,&start)==0);
}
static void detached(vc_pulse *p) {
    assert(!p->stream && !p->active && stream.disconnected==1 && stream.released==1 && stream.callbacks_cleared==5);
    for(unsigned n=0;n<nops;n++) assert(ops[n].released==1);
    vc_tick(p); vc_stop(p); detach_stream(p);
    assert(stream.disconnected==1 && stream.released==1);
}
static void overflow(void) {
    vc_pulse *p=fresh();
    for(unsigned i=1;i<=64;i++) {
        deliver(p,i);
        const uint8_t *data; size_t length; uint64_t seq,start;
        assert(vc_peek(p,i-1,&data,&length,&seq,&start)==1);
    }
    assert(drops==64); deliver(p,65);
    assert(drops==65 && !strcmp(p->status.error,"capture-queue-overflow"));
    deliver(p,66); assert(drops==65 && p->status.blocks==64);
    vc_tick(p); assert(cork_calls==1 && !p->status.stopped);
    complete(0,1); assert(p->status.cork_ack && timing_calls==1 && !p->status.stopped);
    complete(1,1); assert(p->status.barrier_ack && p->status.stopped);
    vc_tick(p); detached(p); prefix(p,64);
    assert(!ops[0].cancelled && !ops[1].cancelled); free(p);
    puts("{\"case\":\"overflow-callback-stop-prefix\",\"acceptedFragments\":64,\"frames\":28224,\"bytes\":112896,\"rejectedFragmentDrops\":1,\"passed\":true}");
}
static void stop_case(unsigned mode) {
    vc_pulse *p=fresh(); deliver(p,1); vc_stop(p);
    if(mode==0) {
        complete(0,1); fake_ms+=2999; vc_tick(p); assert(!p->status.stopped);
        fake_ms++; vc_tick(p); assert(!strcmp(p->status.error,"stop-timeout"));
        assert(p->status.cork_ack && !p->status.barrier_ack && ops[1].cancelled==1);
    } else if(mode==1) {
        complete(0,0); vc_tick(p); assert(!strcmp(p->status.error,"cork-failed")); assert(!p->status.cork_ack && !p->status.barrier_ack);
    } else {
        reject_operation=true; complete(0,1); assert(!strcmp(p->status.error,"operation-create-failed"));
        fake_ms+=3000; vc_tick(p); assert(p->status.cork_ack && !p->status.barrier_ack);
    }
    detached(p); prefix(p,1); free(p);
}
static void fault(unsigned mode) {
    vc_pulse *p=fresh(); deliver(p,1);
    const char *reason;
    if(mode==0) { subscription(&context,PA_SUBSCRIPTION_EVENT_SOURCE|PA_SUBSCRIPTION_EVENT_REMOVE,62,p); reason="source-removed"; }
    else if(mode==1) { context.state=PA_CONTEXT_FAILED; context_state(&context,p); reason="audio-server-disconnected"; }
    else if(mode==2) { pa_server_info info={0};info.cookie=43;server_info(&context,&info,p); reason="server-identity-changed"; }
    else { overflow_cb(&stream,p);reason="server-overflow"; }
    deliver(p,2); assert(p->status.blocks==1 && drops==1);
    overflow_cb(&stream,p); assert(!strcmp(p->status.error,reason));
    vc_tick(p); complete(0,1); complete(1,1); vc_tick(p); detached(p); prefix(p,1);
    vc_cancel(p); assert(!strcmp(p->status.error,reason)); free(p);
}
static void cancel_case(void) {
    vc_pulse *p=fresh(); deliver(p,1); vc_stop(p); assert(nops==1);
    vc_cancel(p); assert(!p->status.error[0] && p->status.stopped && p->consumed==p->produced && p->context==&context);
    assert(ops[0].cancelled==1 && ops[0].released==1); detached(p); free(p);
}
/* Begin reuse test intentionally fails after reset, before any real stream exists. */
pa_stream *pa_stream_new(pa_context *c,const char *name,const pa_sample_spec *spec,const pa_channel_map *map) {
    (void)c;(void)name;(void)spec;(void)map;return NULL;
}
pa_channel_map *pa_channel_map_init_stereo(pa_channel_map *map) {
    memset(map,0,sizeof *map);map->channels=2;map->map[0]=PA_CHANNEL_POSITION_FRONT_LEFT;map->map[1]=PA_CHANNEL_POSITION_FRONT_RIGHT;return map;
}
int pa_stream_connect_record(pa_stream *s,const char *dev,const pa_buffer_attr *a,pa_stream_flags_t flags) {
    (void)s;(void)dev;(void)a;(void)flags;assert(!"unexpected startup connection");return -1;
}
const pa_sample_spec *pa_stream_get_sample_spec(pa_stream *s) { (void)s;assert(!"unexpected startup query");return NULL; }
const pa_channel_map *pa_stream_get_channel_map(pa_stream *s) { (void)s;assert(!"unexpected startup query");return NULL; }
const char *pa_stream_get_device_name(const pa_stream *s) { (void)s;assert(!"unexpected startup query");return NULL; }
uint32_t pa_stream_get_device_index(const pa_stream *s) { (void)s;assert(!"unexpected startup query");return 0; }

static uint8_t *golden(size_t bytes) {
    uint8_t *data=malloc(bytes);assert(data);
    for(size_t i=0;i<bytes;i++) data[i]=(uint8_t)((i*73+(i/251)*19)^((i>>9)*37));
    return data;
}
static void push(vc_pulse *p,const uint8_t *data,size_t bytes) {
    incoming=data;incoming_bytes=bytes;read_cb(&stream,bytes,p);
}
static void finish(vc_pulse *p) {
    vc_stop(p);complete(0,1);complete(1,1);vc_tick(p);detached(p);
}
static void exact_prefix(vc_pulse *p,const uint8_t *expected,size_t bytes) {
    size_t cursor=0;uint64_t expected_seq=p->consumed+1;
    while(cursor<bytes) {
        const uint8_t *data;size_t length;uint64_t seq,start;
        assert(vc_peek(p,0,&data,&length,&seq,&start)==1);
        assert(length && length<=VC_BLOCK_BYTES && length%4==0 && length<=bytes-cursor);
        assert(seq==expected_seq++ && start==cursor/4);
        assert(!memcmp(data,expected+cursor,length));cursor+=length;assert(vc_ack(p,1)==0);
    }
    assert(p->produced==p->consumed && p->status.frames==bytes/4);
}
static void profile(unsigned milliseconds,unsigned pattern,unsigned publication) {
    const size_t initial=publication==1?1764:publication==2?8*VC_BLOCK_BYTES:0;
    const size_t following=(size_t)milliseconds*44100/1000*4,total=initial+following;
    uint8_t *data=golden(total);vc_pulse *p=fresh();
    size_t cursor=0;unsigned sealed=publication==2?8:publication==1?1:0;
    const uint8_t *pointers[8]={0};size_t lengths[8]={0};
    for(unsigned i=0;i<sealed;i++) {
        size_t count=publication==2?VC_BLOCK_BYTES:1764;push(p,data+cursor,count);
        uint64_t seq,start;assert(vc_peek(p,i,&pointers[i],&lengths[i],&seq,&start)==1);
        assert(lengths[i]==count && seq==i+1 && start==cursor/4);cursor+=count;
    }
    const size_t irregular[]={4,1760,VC_BLOCK_BYTES,12,5292};unsigned turn=0,fragments=0;
    while(cursor<total) {
        size_t count=pattern==0?4:pattern==1?1764:pattern==2?VC_BLOCK_BYTES:irregular[turn++%5];
        if(count>total-cursor)count=total-cursor;
        push(p,data+cursor,count);cursor+=count;fragments++;
    }
    assert(!p->status.error[0] && p->status.frames==total/4);
    size_t published_bytes=0;
    for(unsigned i=0;i<sealed;i++) {
        const uint8_t *again;size_t length;uint64_t seq,start;
        assert(vc_peek(p,i,&again,&length,&seq,&start)==1);
        assert(again==pointers[i] && length==lengths[i] && seq==i+1 && start==published_bytes/4);
        assert(!memcmp(again,data+published_bytes,length));published_bytes+=length;
    }
    /* A non-full final tail is immediately visible; Stop adds no hidden audio. */
    const uint8_t *tail;size_t length;uint64_t seq,start;
    assert(vc_peek(p,(uint32_t)(p->produced-1),&tail,&length,&seq,&start)==1);
    assert(start*4+length==total);
    uint64_t blocks=p->status.blocks;finish(p);assert(p->status.blocks==blocks);exact_prefix(p,data,total);
    printf("{\"case\":\"pcm-profile\",\"extentMs\":%u,\"wallClockMeasured\":false,\"pattern\":%u,\"initialPublishedBlocks\":%u,\"incomingFragments\":%u,\"frames\":%zu,\"bytes\":%zu,\"blocks\":%llu,\"exactPcm\":true}\n",
           milliseconds,pattern,sealed,fragments,total/4,total,(unsigned long long)blocks);
    free(p);free(data);
}
static void split_edge(void) {
    vc_pulse *p=fresh();size_t total=VC_BLOCK_BYTES+8;uint8_t *data=golden(total);
    push(p,data,VC_BLOCK_BYTES-4);push(p,data+VC_BLOCK_BYTES-4,12);
    assert(p->produced==2 && p->slots[0].length==VC_BLOCK_BYTES && p->slots[1].length==8);
    finish(p);exact_prefix(p,data,total);free(data);free(p);
}
static void capacity_edge(void) {
    vc_pulse *p=fresh();size_t total=VC_SLOTS*VC_BLOCK_BYTES-4;uint8_t *data=golden(total);
    for(unsigned i=0;i<VC_SLOTS;i++)push(p,data+i*VC_BLOCK_BYTES,i==VC_SLOTS-1?VC_BLOCK_BYTES-4:VC_BLOCK_BYTES);
    assert(p->produced==64);uint64_t frames=p->status.frames;uint8_t extra[8]={9};push(p,extra,8);
    assert(!strcmp(p->status.error,"capture-queue-overflow") && p->status.frames==frames && p->slots[63].length==VC_BLOCK_BYTES-4);
    finish(p);exact_prefix(p,data,total);free(data);free(p);
    /* Separate fresh full queue: the final four bytes fit without a new slot. */
    p=fresh();total=VC_SLOTS*VC_BLOCK_BYTES;data=golden(total);
    for(unsigned i=0;i<VC_SLOTS;i++)push(p,data+i*VC_BLOCK_BYTES,i==VC_SLOTS-1?VC_BLOCK_BYTES-4:VC_BLOCK_BYTES);
    push(p,data+total-4,4);
    assert(!p->status.error[0] && p->produced==64 && p->slots[63].length==VC_BLOCK_BYTES && p->status.frames==total/4);
    push(p,extra,4);
    assert(!strcmp(p->status.error,"capture-queue-overflow") && p->status.frames==total/4);
    finish(p);exact_prefix(p,data,total);free(data);free(p);
}
static void highwater_edge(void) {
    vc_pulse *p=fresh();size_t total=2*VC_BLOCK_BYTES+8;uint8_t *data=golden(total);
    push(p,data,VC_BLOCK_BYTES);push(p,data+VC_BLOCK_BYTES,VC_BLOCK_BYTES);push(p,data+2*VC_BLOCK_BYTES,4);
    const uint8_t *last;size_t length;uint64_t seq,start;assert(vc_peek(p,2,&last,&length,&seq,&start)==1 && length==4);
    uint8_t saved[4];memcpy(saved,last,4);
    const uint8_t *earlier;assert(vc_peek(p,0,&earlier,&length,&seq,&start)==1);
    push(p,data+2*VC_BLOCK_BYTES+4,4);
    assert(p->produced==4 && p->slots[2].length==4 && !memcmp(last,saved,4));
    finish(p);exact_prefix(p,data,total);free(data);free(p);
}
static void wrap_edge(void) {
    vc_pulse *p=fresh();uint8_t data[4]={1,2,3,4};
    for(unsigned i=0;i<3*VC_SLOTS;i++) {
        push(p,data,4);const uint8_t *actual;size_t length;uint64_t seq,start;
        assert(vc_peek(p,0,&actual,&length,&seq,&start)==1 && length==4 && seq==i+1 && start==i && !memcmp(actual,data,4));
        assert(vc_ack(p,1)==0);
    }
    assert(!p->status.error[0]);finish(p);free(p);
}
static void reuse_edge(void) {
    vc_pulse *p=fresh();deliver(p,1);const uint8_t *data;size_t length;uint64_t seq,start;
    assert(vc_peek(p,0,&data,&length,&seq,&start)==1);vc_cancel(p);
    p->subscribed=true;vc_source source={0};strcpy(source.serial,"62");
    assert(vc_begin(p,&source,0)==-1 && !strcmp(p->status.error,"stream-create-failed"));
    assert(p->produced==0 && p->consumed==0 && p->exposed_through==0);
    detach_stream(p);free(p);
}
static void ceiling_edge(void) {
    vc_pulse *p=fresh();p->status.frames=VC_MAX_FRAMES-3;uint8_t data[16]={1,2,3,4,5,6,7,8,9,10,11,12};
    push(p,data,4);push(p,data+4,12);assert(p->status.frames==VC_MAX_FRAMES && p->status.limit_reached && p->produced==1);
    assert(p->slots[0].length==12 && p->slots[0].start==VC_MAX_FRAMES-3 && !memcmp(p->slots[0].bytes,data,12));
    finish(p);free(p);
}
static void terminal_tail_edge(void) {
    vc_pulse *p=fresh();uint8_t *data=golden(12);push(p,data,4);push(p,data+4,8);
    assert(p->produced==1 && p->status.frames==3);finish(p);exact_prefix(p,data,12);free(data);free(p);
}
/* Existing sealed partials reduce usable bytes without changing memory bounds. */
static void occupancy_profile(unsigned sealed) {
    const size_t initial=(size_t)sealed*1764,following=176400,total=initial+following;
    const size_t capacity=(VC_SLOTS-sealed)*VC_BLOCK_BYTES;
    const size_t retained_following=following<capacity?following:capacity;
    const size_t retained=initial+retained_following;
    vc_pulse *p=fresh();uint8_t *data=golden(total);
    for(unsigned i=0;i<sealed;i++) {
        push(p,data+(size_t)i*1764,1764);
        const uint8_t *offered;size_t length;uint64_t seq,start;
        assert(vc_peek(p,i,&offered,&length,&seq,&start)==1 && length==1764);
    }
    for(unsigned i=0;i<100;i++)push(p,data+initial+(size_t)i*1764,1764);
    assert(p->status.frames==retained/4);
    assert((p->status.error[0]!=0)==(following>capacity));
    if(following>capacity)assert(!strcmp(p->status.error,"capture-queue-overflow"));
    uint64_t blocks=p->produced;finish(p);exact_prefix(p,data,retained);
    printf("{\"case\":\"occupied-profile\",\"extentMs\":1000,\"wallClockMeasured\":false,\"initialPublishedBlocks\":%u,\"incomingFragments\":100,\"availableAppendBytes\":%zu,\"retainedFollowingBytes\":%zu,\"retainedBytes\":%zu,\"frames\":%zu,\"blocks\":%llu,\"expectedOverflow\":%s,\"exactPcm\":true}\n",
           sealed,capacity,retained_following,retained,retained/4,(unsigned long long)blocks,following>capacity?"true":"false");
    free(data);free(p);
}
int main(void) {
    overflow();for(unsigned i=0;i<3;i++)stop_case(i);for(unsigned i=0;i<4;i++)fault(i);cancel_case();
    const unsigned durations[]={200,500,1000,2000};
    for(unsigned d=0;d<4;d++)for(unsigned pattern=0;pattern<4;pattern++)for(unsigned publication=0;publication<3;publication++)profile(durations[d],pattern,publication);
    split_edge();capacity_edge();highwater_edge();wrap_edge();reuse_edge();ceiling_edge();terminal_tail_edge();occupancy_profile(56);occupancy_profile(63);
    puts("{\"passed\":true,\"cases\":66,\"actualProductionCallbacks\":true,\"pulseTransportMocked\":true,\"deviceConnections\":0}");return 0;
}
