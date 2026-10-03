// World pixels travelled in one complete left/right walking cycle.
export const WALK_CYCLE_DISTANCE = 112;

export const cyclePhase = (phase: number) => ((phase % 1) + 1) % 1;

export function crossedFootPlant(previous: number, distance: number) {
  // Do not depend on hitting a narrow phase window: fast steps and sparse
  // snapshots can skip it. The second foot contacts half a cycle later.
  return Math.floor((previous + distance / WALK_CYCLE_DISTANCE) * 2) > Math.floor(previous * 2);
}
