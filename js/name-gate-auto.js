// name-gate-auto.js - drop-in name gate for pages that CANNOT await it.
//
// The module games mount through `await requireName()` in their standalone page's inline module, so
// the game never initialises until the device has a name. Monopoly Deal and Parchís are classic
// (non-module) script pages built as whole apps, with no single mount point to await, so they get
// the gate as a side effect instead:
//
//   <script type="module" src="../js/name-gate-auto.js"></script>
//
// The overlay is undismissable and sits above everything (see css/name-gate.css's z-index), so the
// app underneath may boot but cannot be PLAYED until a name is entered - which is the requirement.
// Module scripts are deferred, so this runs after the page's own scripts, never blocking them.

import { requireName } from './name-gate.js';

requireName();
