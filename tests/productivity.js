import {SessionTimer} from '../src/productivity/timers.js';

function assert(value, message) {
    if (!value)
        throw new Error(message);
}
let now = 1000;
const clock = () => now;
const timer = new SessionTimer(clock, 10000);
timer.start();
now += 2345;
assert(timer.value === 2345 && timer.remaining === 7655, 'monotonic elapsed accuracy');
timer.pause();
now += 100000;
assert(timer.value === 2345, 'paused clock advanced');
timer.start();
now += 7655;
assert(timer.finish() && !timer.running && !timer.finish(), 'single completion');
timer.nextPhase(10000, 5000);
assert(timer.phase === 'break' && timer.sessions === 1 && timer.duration === 5000, 'focus transition');
timer.start();
now += 5000;
assert(timer.finish(), 'break completion');
timer.nextPhase(10000, 5000);
assert(timer.phase === 'focus' && timer.sessions === 1, 'break transition');
const watch = new SessionTimer(clock);
watch.start();
now += 3456;
watch.lap();
const saved = JSON.parse(JSON.stringify(watch.snapshot()));
const recovered = new SessionTimer(clock);
recovered.restore(saved);
now += 99999;
assert(!recovered.running && recovered.value === 3456 && recovered.laps[0] === 3456, 'paused persistence recovery');
recovered.start();
now += 123;
assert(recovered.value === 3579, 'resume recovered timer');
recovered.reset();
assert(recovered.value === 0 && !recovered.running && !recovered.laps.length, 'reset cleanup');
recovered.restore({elapsed: -5, duration: NaN});
assert(recovered.value === 0, 'malformed persistence accepted');
console.log('PASS monotonic accuracy, pause/resume, completion, Pomodoro transitions, laps, persistence, reset');
