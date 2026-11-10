import * as Config from 'resource:///org/gnome/shell/misc/config.js';

// The metadata admits only tested majors (46, 48, 50, 51); the code differs
// between them only where a Shell API was added or removed.
export const SHELL_MAJOR = Number.parseInt(Config.PACKAGE_VERSION, 10);
