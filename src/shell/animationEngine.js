import Clutter from 'gi://Clutter';
import St from 'gi://St';

const CURVES = {
    nova: [Clutter.AnimationMode.EASE_OUT_QUINT, Clutter.AnimationMode.EASE_OUT_QUAD],
    smooth: [Clutter.AnimationMode.EASE_IN_OUT_CUBIC, Clutter.AnimationMode.EASE_IN_OUT_CUBIC],
    spring: [Clutter.AnimationMode.EASE_OUT_BACK, Clutter.AnimationMode.EASE_IN_QUAD],
    fade: [Clutter.AnimationMode.EASE_OUT_QUAD, Clutter.AnimationMode.EASE_OUT_QUAD],
};

export function motionEnabled(settings) {
    const {enableAnimations, reducedMotion} = St.Settings.get();
    return enableAnimations && reducedMotion !== St.ReducedMotion.REDUCE && !settings.reduceMotion;
}

export class AnimationEngine {
    #surface;
    #settings;
    #generation = 0;

    constructor(surface, settings) {
        this.#surface = surface;
        this.#settings = settings;
    }

    #stop() {
        this.#generation++;
        this.#surface.remove_all_transitions();
        this.#surface.first_child.remove_all_transitions();
    }

    hide() {
        this.#stop();
        this.#surface.hide();
    }

    // Content-driven size changes while open (module switch, list growth).
    resize(bounds) {
        const surface = this.#surface;
        if (!surface.visible)
            return;
        const {speed, expand} = this.#settings.motion;
        const duration = Math.round(Math.min(expand, 260) * 100 / speed);
        if (!motionEnabled(this.#settings) || duration === 0) {
            surface.remove_all_transitions();
            surface.opacity = 255;
            surface.first_child.opacity = 255;
            surface.set_position(bounds.x, bounds.y);
            surface.set_size(bounds.width, bounds.height);
            return;
        }
        surface.ease({...bounds, opacity: 255, duration, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        surface.first_child.ease({opacity: 255, duration, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
    }

    present(bounds, anchorWidth, expanded, animate) {
        const surface = this.#surface;
        this.#stop();
        surface.reactive = expanded;
        const {speed, expand, collapse, fade, intensity, style} = this.#settings.motion;
        const duration = Math.round((expanded ? expand : collapse) * 100 / speed);
        const fadeDuration = Math.round(fade * 100 / speed);
        const content = surface.first_child;
        if (!animate || !motionEnabled(this.#settings) || (duration === 0 && fadeDuration === 0)) {
            if (expanded) {
                surface.set_position(bounds.x, bounds.y);
                surface.set_size(bounds.width, bounds.height);
                surface.opacity = 255;
                content.opacity = 255;
                surface.show();
            } else {
                surface.hide();
            }
            return;
        }

        const amount = style === 'fade' ? 0 : intensity;
        const startWidth = bounds.width - (bounds.width - Math.min(anchorWidth, bounds.width)) * amount;
        const small = {
            x: bounds.x + (bounds.width - startWidth) / 2,
            y: bounds.y,
            width: startWidth,
            height: Math.round(bounds.height * (1 - 0.35 * amount)),
        };
        const [expandCurve, collapseCurve] = CURVES[style] ?? CURVES.nova;
        const generation = this.#generation;
        if (expanded) {
            if (!surface.visible) {
                surface.set_position(small.x, small.y);
                surface.set_size(small.width, small.height);
                surface.opacity = 0;
                content.opacity = fadeDuration > 0 ? 0 : 255;
                surface.show();
            }
            surface.ease({...bounds, opacity: 255, duration, mode: expandCurve});
            content.ease({opacity: 255, duration: fadeDuration, mode: expandCurve});
        } else if (surface.visible) {
            const completion = () => {
                if (this.#generation === generation)
                    surface.hide();
            };
            content.ease({opacity: 0, duration: fadeDuration, mode: collapseCurve,
                onComplete: fadeDuration > duration ? completion : undefined});
            surface.ease({...small, opacity: 0, duration, mode: collapseCurve,
                onComplete: duration >= fadeDuration ? completion : undefined});
        }
    }
}
