#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <linux/uinput.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

static void emit_event(int fd, int type, int code, int value) {
  struct input_event event;
  memset(&event, 0, sizeof(event));
  event.type = type;
  event.code = code;
  event.value = value;
  if (write(fd, &event, sizeof(event)) < 0) {
    perror("write");
    exit(1);
  }
}

static void sync_events(int fd) {
  emit_event(fd, EV_SYN, SYN_REPORT, 0);
}

static void set_key(int fd, int key, int value) {
  emit_event(fd, EV_KEY, key, value);
  sync_events(fd);
}

static void enable_key(int fd, int key) {
  if (ioctl(fd, UI_SET_KEYBIT, key) < 0) {
    perror("UI_SET_KEYBIT");
    exit(1);
  }
}

int main(int argc, char **argv) {
  int delay_ms = 3500;
  if (argc > 1) {
    delay_ms = atoi(argv[1]);
    if (delay_ms < 0) {
      delay_ms = 0;
    }
  }

  int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
  if (fd < 0) {
    perror("open /dev/uinput");
    return 1;
  }

  if (ioctl(fd, UI_SET_EVBIT, EV_KEY) < 0) {
    perror("UI_SET_EVBIT EV_KEY");
    return 1;
  }
  if (ioctl(fd, UI_SET_EVBIT, EV_SYN) < 0) {
    perror("UI_SET_EVBIT EV_SYN");
    return 1;
  }

  enable_key(fd, KEY_LEFTALT);
  enable_key(fd, KEY_R);
  enable_key(fd, KEY_D);
  enable_key(fd, KEY_LEFTSHIFT);

  struct uinput_setup setup;
  memset(&setup, 0, sizeof(setup));
  setup.id.bustype = BUS_USB;
  setup.id.vendor = 0x1209;
  setup.id.product = 0x2026;
  snprintf(setup.name, UINPUT_MAX_NAME_SIZE, "VOCO runtime smoke keyboard");

  if (ioctl(fd, UI_DEV_SETUP, &setup) < 0) {
    perror("UI_DEV_SETUP");
    return 1;
  }
  if (ioctl(fd, UI_DEV_CREATE) < 0) {
    perror("UI_DEV_CREATE");
    return 1;
  }

  usleep((useconds_t)delay_ms * 1000);
  set_key(fd, KEY_LEFTALT, 1);
  usleep(80000);
  set_key(fd, KEY_LEFTSHIFT, 1);
  usleep(80000);
  set_key(fd, KEY_R, 1);
  usleep(80000);
  set_key(fd, KEY_R, 0);
  usleep(80000);
  set_key(fd, KEY_LEFTSHIFT, 0);
  usleep(80000);
  set_key(fd, KEY_LEFTALT, 0);
  usleep(250000);

  if (ioctl(fd, UI_DEV_DESTROY) < 0) {
    perror("UI_DEV_DESTROY");
    close(fd);
    return 1;
  }
  close(fd);
  return 0;
}
