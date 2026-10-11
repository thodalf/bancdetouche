import { Fixture, GameState, LiveCommand, LiveMatchState } from '../models';
import { MatchSimulation, Side } from './match-engine';
import { Rng } from './rng';
import { sideInput, userMatchSeed } from './season';

/** Fige les deux équipes au coup d'envoi : le match ne dépend plus de l'état du jeu. */
export function createLiveMatch(s: GameState, f: Fixture, instant: boolean): LiveMatchState {
  return {
    fixtureId: f.id,
    seed: userMatchSeed(s),
    home: structuredClone(sideInput(s, f.homeId)),
    away: structuredClone(sideInput(s, f.awayId)),
    allowDraw: f.competition === 'league',
    userSide: f.homeId === s.userClubId ? 'home' : 'away',
    commands: [],
    minute: 0,
    instant,
  };
}

export function applyCommand(sim: MatchSimulation, side: Side, cmd: LiveCommand): string | null {
  switch (cmd.kind) {
    case 'style':
      sim.setStyle(side, cmd.style);
      return null;
    case 'formation':
      sim.changeFormation(side, cmd.formation);
      return null;
    case 'sub':
      return sim.substitute(side, cmd.outId, cmd.inId);
    case 'instructions':
      sim.setInstructions(side, cmd.instructions, cmd.style, cmd.label);
      return null;
    case 'talk':
      return sim.teamTalk(side, cmd.tone);
  }
}

/**
 * Reconstruit la simulation jusqu'à `upTo` en rejouant les décisions de l'entraîneur
 * à la minute exacte où elles ont été prises. Même graine + mêmes décisions = même match.
 */
export function replayLiveMatch(live: LiveMatchState, upTo = live.minute): MatchSimulation {
  const sim = new MatchSimulation(live.home, live.away, new Rng(live.seed), live.allowDraw);
  const apply = () => live.commands.filter((c) => c.minute === sim.minute).forEach((c) => applyCommand(sim, live.userSide, c));
  while (sim.minute < upTo && !sim.finished) {
    apply();
    sim.step();
  }
  if (!sim.finished) apply();
  return sim;
}
