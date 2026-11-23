// Stable identifiers shared by every engine module.
// No display strings live here: the UI layer owns all text.

export const ENGINE_VERSION = 1;

export const MODES = ['classic', 'custom'];

// Player ids: 1-64 characters from letters, digits, underscore and hyphen.
export const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 15;

// Tool ids, in the order of the tools table in the design document.
export const TOOL_IDS = [
  'detector',
  'probe',
  'counter',
  'skip',
  'swap',
  'flip',
  'shuffle',
  'double',
  'reverse',
  'link',
  'jail',
  'handSwap',
  'steal',
  'shotShield',
  'toolShield',
  'heal',
];

// timing:  'turn'    = only in the owner's turn
//          'anytime' = any moment, even during other players' turns
// hidden:  'always'  = never produces a public event
//          'classic' = hidden in Classic, announced in Custom
//          'never'   = always announced
// targeted: the tool is "used against" other players, so a tool shield can block it
// modes:   the modes the tool may appear in
export const TOOL_INFO = {
  detector: { timing: 'turn', hidden: 'always', targeted: false, modes: ['classic', 'custom'] },
  probe: { timing: 'turn', hidden: 'always', targeted: false, modes: ['classic', 'custom'] },
  counter: { timing: 'turn', hidden: 'always', targeted: false, modes: ['classic', 'custom'] },
  skip: { timing: 'turn', hidden: 'classic', targeted: false, modes: ['classic', 'custom'] },
  swap: { timing: 'turn', hidden: 'always', targeted: false, modes: ['classic'] },
  flip: { timing: 'turn', hidden: 'always', targeted: false, modes: ['classic', 'custom'] },
  shuffle: { timing: 'turn', hidden: 'never', targeted: false, modes: ['classic', 'custom'] },
  double: { timing: 'turn', hidden: 'never', targeted: false, modes: ['classic', 'custom'] },
  reverse: { timing: 'turn', hidden: 'never', targeted: false, modes: ['classic', 'custom'] },
  link: { timing: 'turn', hidden: 'never', targeted: true, modes: ['classic', 'custom'] },
  jail: { timing: 'turn', hidden: 'never', targeted: true, modes: ['classic', 'custom'] },
  handSwap: { timing: 'turn', hidden: 'never', targeted: true, modes: ['classic', 'custom'] },
  steal: { timing: 'turn', hidden: 'never', targeted: true, modes: ['classic', 'custom'] },
  shotShield: { timing: 'anytime', hidden: 'always', targeted: false, modes: ['classic', 'custom'] },
  toolShield: { timing: 'anytime', hidden: 'always', targeted: false, modes: ['classic', 'custom'] },
  heal: { timing: 'anytime', hidden: 'never', targeted: false, modes: ['classic', 'custom'] },
};

// True only for real tool ids (never for inherited object keys like 'constructor').
export function isToolId(tool) {
  return typeof tool === 'string' && TOOL_IDS.includes(tool);
}

export function isHiddenTool(tool, mode) {
  const hidden = TOOL_INFO[tool].hidden;
  return hidden === 'always' || (hidden === 'classic' && mode === 'classic');
}

export function toolsForMode(mode) {
  return TOOL_IDS.filter((t) => TOOL_INFO[t].modes.includes(mode));
}

export const CHAMBER_TYPES = ['live', 'blank'];

export const PHASES = ['turn', 'confirm', 'handSwap', 'steal', 'ended'];

// A loot offer lasts this long (decision 63; fixed by the design, not a setting).
// The engine has no clock: the looter's device sends the expiry.
export const LOOT_SECONDS = 15;

export const ACTION_TYPES = [
  'chooseTarget',
  'confirmShot',
  'cancelTarget',
  'useTool',
  'handSwapTarget',
  'stealChoice',
  'lootChoice',
  'setPreference',
  'buy',
  'transfer',
  'ransomOffer',
  'ransomWithdraw',
  'ransomAccept',
  'ransomReject',
  'predict',
  'timeout',
  'removePlayer',
];

// Error codes returned by applyAction / createMatch.
export const ERR = {
  INVALID_CONFIG: 'INVALID_CONFIG',
  INVALID_PLAYERS: 'INVALID_PLAYERS',
  INVALID_SEED: 'INVALID_SEED',
  INVALID_STATE: 'INVALID_STATE',
  INVALID_ACTION: 'INVALID_ACTION',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  MATCH_ENDED: 'MATCH_ENDED',
  UNKNOWN_PLAYER: 'UNKNOWN_PLAYER',
  PLAYER_ELIMINATED: 'PLAYER_ELIMINATED',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  WRONG_PHASE: 'WRONG_PHASE',
  INVALID_TARGET: 'INVALID_TARGET',
  UNKNOWN_TOOL: 'UNKNOWN_TOOL',
  TOOL_NOT_IN_HAND: 'TOOL_NOT_IN_HAND',
  TOOL_LIMIT_REACHED: 'TOOL_LIMIT_REACHED',
  DOUBLE_ALREADY_ACTIVE: 'DOUBLE_ALREADY_ACTIVE',
  HP_FULL: 'HP_FULL',
  INVALID_CHOICE: 'INVALID_CHOICE',
  NO_LOOT: 'NO_LOOT',
  NOT_CUSTOM_MODE: 'NOT_CUSTOM_MODE',
  TOOL_NOT_FOR_SALE: 'TOOL_NOT_FOR_SALE',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  INSUFFICIENT_COINS: 'INSUFFICIENT_COINS',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  NOT_JAILED: 'NOT_JAILED',
  NO_OFFER: 'NO_OFFER',
  OFFER_NOT_FUNDED: 'OFFER_NOT_FUNDED',
  NOT_A_GHOST: 'NOT_A_GHOST',
  INVALID_PREDICTION: 'INVALID_PREDICTION',
  STALE_TIMEOUT: 'STALE_TIMEOUT',
};
