import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

// ScrollController's void signal always consumes nonzero deltas. A conditional
// action lets the stable Island actors propagate content/control events intact.
export const IslandScrollAction = GObject.registerClass(
class IslandScrollAction extends Clutter.Action {
    _init(handle) {
        super._init();
        this._handle = handle;
    }

    vfunc_handle_event(event) {
        return this._handle(event);
    }
});
