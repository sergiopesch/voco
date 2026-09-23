/* Test-only syscall boundary for the unchanged production daemon. Never packaged.
 * The enclosing bwrap namespace has no input devices. /dev/uinput is redirected
 * to a regular event file; the real daemon's setup, framing and Emit code runs. */
#define _GNU_SOURCE
#include <assert.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/uinput.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

static int input_fd = -1;
static atomic_int accepted_once;
static atomic_int received_once;
static unsigned event_mask, key_count, relative_count, absolute_count;
static struct uinput_setup setup;

static int mode_is(const char *value) {
    const char *mode = getenv("VOCO_TEST_FAILURE");
    return mode && strcmp(mode, value) == 0;
}

int open(const char *path, int flags, ...) {
    int (*real_open)(const char *, int, ...) = dlsym(RTLD_NEXT, "open");
    mode_t mode = 0;
    if (flags & O_CREAT) {
        va_list args; va_start(args, flags); mode = va_arg(args, int); va_end(args);
    }
    if (strcmp(path, "/dev/uinput") != 0) return real_open(path, flags, mode);
    assert(flags == (O_WRONLY | O_NONBLOCK));
    if (mode_is("uinput-open")) { errno = EACCES; return -1; }
    const char *target = getenv("VOCO_TEST_EVENTS");
    assert(target && target[0] == '/');
    input_fd = real_open(target, O_WRONLY | O_CREAT | O_APPEND, 0600);
    assert(input_fd >= 0);
    return input_fd;
}

int ioctl(int fd, unsigned long request, ...) {
    unsigned long value = 0;
    if (request != UI_DEV_CREATE && request != UI_DEV_DESTROY) {
        va_list args; va_start(args, request); value = va_arg(args, unsigned long); va_end(args);
    }
    if (fd != input_fd) {
        int (*real_ioctl)(int, unsigned long, ...) = dlsym(RTLD_NEXT, "ioctl");
        return real_ioctl(fd, request, value);
    }
    if (mode_is("uinput-setup")) { errno = EIO; return -1; }
    switch (request) {
        case UI_SET_EVBIT: assert(value < 32); event_mask |= 1u << value; break;
        case UI_SET_KEYBIT: key_count++; break;
        case UI_SET_RELBIT: relative_count++; break;
        case UI_SET_ABSBIT: absolute_count++; break;
        case UI_ABS_SETUP: break;
        case UI_SET_PROPBIT: break;
        case UI_DEV_SETUP: memcpy(&setup, (void *)value, sizeof(setup)); break;
        case UI_DEV_CREATE: {
            const char *target = getenv("VOCO_TEST_SETUP");
            char *temporary;
            assert(target && asprintf(&temporary, "%s.tmp", target) >= 0);
            FILE *receipt = fopen(temporary, "wx");
            assert(receipt);
            fprintf(receipt, "{\"device\":\"%s\",\"events\":%u,\"keys\":%u,\"relativeAxes\":%u,\"absoluteAxes\":%u}\n",
                    setup.name, event_mask, key_count, relative_count, absolute_count);
            assert(fclose(receipt) == 0);
            assert(rename(temporary, target) == 0);
            free(temporary);
            break;
        }
        case UI_DEV_DESTROY: break;
        default: assert(!"Unexpected uinput ioctl");
    }
    return 0;
}

int accept(int fd, struct sockaddr *address, socklen_t *length) {
    int (*real_accept)(int, struct sockaddr *, socklen_t *) = dlsym(RTLD_NEXT, "accept");
    if (atomic_exchange(&accepted_once, 1) == 0) {
        if (mode_is("accept-eintr")) { errno = EINTR; return -1; }
        if (mode_is("accept-emfile")) { errno = EMFILE; return -1; }
        if (mode_is("accept-ebadf")) { errno = EBADF; return -1; }
        if (mode_is("fd-zero")) assert(close(STDIN_FILENO) == 0);
    }
    int accepted = real_accept(fd, address, length);
    if (mode_is("fd-zero") && accepted == 0) {
        FILE *receipt = fopen(getenv("VOCO_TEST_ACCEPTED"), "w");
        assert(receipt);
        fprintf(receipt, "%d\n", accepted);
        assert(fclose(receipt) == 0);
    }
    return accepted;
}

ssize_t recv(int fd, void *buffer, size_t size, int flags) {
    ssize_t (*real_recv)(int, void *, size_t, int) = dlsym(RTLD_NEXT, "recv");
    if (atomic_exchange(&received_once, 1) == 0 && mode_is("recv-eintr")) {
        errno = EINTR;
        return -1;
    }
    return real_recv(fd, buffer, size, flags);
}

int pthread_create(pthread_t *thread, const pthread_attr_t *attributes,
                   void *(*start)(void *), void *arg) {
    if (mode_is("thread-create")) return EAGAIN;
    int (*real_create)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *) =
        dlsym(RTLD_NEXT, "pthread_create");
    return real_create(thread, attributes, start, arg);
}
