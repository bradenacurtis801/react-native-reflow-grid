/** How cells glide to a new place: a quick spring, so one set going while another is still moving carries on from where it is. */
export const MOVE = { damping: 26, stiffness: 320, mass: 0.9 };
/** A cell leaving shrinks and fades over this long (ms). */
export const LEAVE_MS = 180;
export const LEAVE_SCALE = 0.5;
/** A cell added later starts this small and grows in. */
export const ENTER_SCALE = 0.6;
/** A lifted item is this much bigger. */
export const LIFT_SCALE = 1.06;
/** A dragged item's slot dims to this, to show where it will land. */
export const DRAGGED_OPACITY = 0.35;
