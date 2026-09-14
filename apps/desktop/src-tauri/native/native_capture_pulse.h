#ifndef VOCO_NATIVE_CAPTURE_PULSE_H
#define VOCO_NATIVE_CAPTURE_PULSE_H
#include <stddef.h>
#include <stdint.h>
#define VC_SOURCE_CAP 128
#define VC_BLOCK_BYTES 35280
#define VC_SLOTS 64
#define VC_MAX_FRAMES UINT64_C(26460000)
/* This is VOCO's owned ABI. No libpulse structures cross it. */
typedef struct vc_pulse vc_pulse;
typedef struct {
    char name[512], label[512], serial[128];
    uint32_t index;
    int monitor;
} vc_source;
typedef struct {
    uint64_t revision;
    uint32_t count;
    char default_name[512];
    vc_source sources[VC_SOURCE_CAP];
} vc_catalog;
typedef struct {
    uint64_t frames, blocks;
    int ready, stopped, cork_ack, barrier_ack, limit_reached;
    char error[128];
} vc_status;
vc_pulse *vc_new(const char *socket_path);
void vc_free(vc_pulse *p);
int vc_enumerate(vc_pulse *p, vc_catalog *out);
int vc_begin(vc_pulse *p, const vc_source *source, uint64_t revision);
void vc_tick(vc_pulse *p);
void vc_stop(vc_pulse *p);
void vc_cancel(vc_pulse *p);
void vc_get_status(vc_pulse *p, vc_status *out);
/* Returned memory remains owned by C and immutable until ack/cancel.
 * Partial blocks are available immediately; peek seals their current extent. */
int vc_peek(vc_pulse *p, uint32_t offset, const uint8_t **bytes, size_t *length, uint64_t *sequence, uint64_t *frame_start);
int vc_ack(vc_pulse *p, uint32_t count);
#endif
