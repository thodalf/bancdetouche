import { Rng } from './rng';

/** Phrases de commentaire. {p} = joueur, {a} = passeur, {t} = équipe. */
const LINES = {
  goal: [
    'BUT ! {p} conclut une belle action et trompe le gardien.',
    'BUT ! {p} reprend de volée, imparable !',
    'BUT ! Frappe enroulée de {p}, la lucarne !',
    'BUT ! {p} surgit au second poteau et pousse le ballon au fond.',
    'BUT ! {p} s\'arrache et marque d\'une tête puissante.',
    'BUT ! {p} élimine son défenseur et ajuste le gardien.',
  ],
  assist: [' Passe décisive de {a}.', ' Superbe service de {a}.', ' Centre millimétré de {a}.'],
  save: [
    'Arrêt décisif du gardien devant {p} !',
    '{p} frappe fort, le gardien se détend et repousse.',
    'Tête de {p} captée sans difficulté par le portier.',
  ],
  chance: [
    '{p} frappe au-dessus, l\'occasion était belle.',
    'Le tir de {p} frôle le poteau !',
    '{p} manque le cadre de peu.',
    'Grosse occasion pour {t}, mais {p} croise trop sa frappe.',
  ],
  yellow: ['Carton jaune pour {p} après une faute grossière.', '{p} est averti pour un tacle en retard.', 'L\'arbitre sort le jaune : {p} conteste trop.'],
  secondYellow: ['Deuxième jaune pour {p} : expulsion ! {t} va finir à dix.'],
  red: ['Carton rouge direct pour {p} ! Une faute dangereuse qui laisse {t} à dix.'],
  injury: ['{p} se tient la cuisse et doit sortir sur blessure.', '{p} reste au sol, touché à la cheville. Il ne peut pas continuer.'],
  sub: [' {a} le remplace.'],
};

export type LineKey = keyof typeof LINES;

export function line(rng: Rng, key: LineKey, vars: { p?: string; a?: string; t?: string }): string {
  return rng
    .pick(LINES[key])
    .replaceAll('{p}', vars.p ?? '')
    .replaceAll('{a}', vars.a ?? '')
    .replaceAll('{t}', vars.t ?? '');
}
