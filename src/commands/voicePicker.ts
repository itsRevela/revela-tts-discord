import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type APIActionRowComponent,
  type APIComponentInActionRow,
} from 'discord.js';
import type { ModelCatalog } from '../tts/modelCatalog.ts';
import {
  ALL_VOICES,
  voiceEntries,
  entriesInGroup,
  entryLabel,
  entryValue,
  voiceGroups,
  type VoiceEntry,
  type VoiceListOptions,
} from '../tts/voiceDirectory.ts';

/** Discord select menus hold at most 25 options, so that is one page. */
export const PICKER_PAGE_SIZE = 25;
/** Component custom ids start with the command name so the router can find /voice. */
export const PICKER_PREFIX = 'voice';
const MAX_TEXT = 100;

export type PickerAction = 'filter' | 'pick' | 'prev' | 'next';

export interface PickerState {
  readonly groupId: string;
  readonly page: number;
}

export interface PickerView {
  readonly content: string;
  readonly components: APIActionRowComponent<APIComponentInActionRow>[];
}

/** "voice:next:kokoro-en:0" carries the filter and page, so the picker needs no server-side state. */
export function pickerCustomId(action: PickerAction, state: PickerState): string {
  return `${PICKER_PREFIX}:${action}:${state.groupId}:${state.page}`;
}

export function parsePickerCustomId(customId: string): { action: PickerAction; state: PickerState } | undefined {
  const [prefix, action, groupId, page] = customId.split(':');
  const actions: readonly string[] = ['filter', 'pick', 'prev', 'next'];
  if (prefix !== PICKER_PREFIX || !action || !actions.includes(action) || !groupId) return undefined;
  const pageNumber = Number(page);
  return {
    action: action as PickerAction,
    state: { groupId, page: Number.isInteger(pageNumber) && pageNumber >= 0 ? pageNumber : 0 },
  };
}

const clip = (text: string): string => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);

function pageCount(entries: readonly VoiceEntry[]): number {
  return Math.max(1, Math.ceil(entries.length / PICKER_PAGE_SIZE));
}

/** Where to open the picker: the filter and page holding the user's current voice. */
export function initialPickerState(catalog: ModelCatalog, currentValue: string, options: VoiceListOptions = {}): PickerState {
  const entries = voiceEntries(catalog, options);
  const current = entries.find((entry) => entryValue(entry) === currentValue);
  if (!current) return { groupId: ALL_VOICES.id, page: 0 };
  const inGroup = entriesInGroup(entries, current.group.id);
  return { groupId: current.group.id, page: Math.floor(inGroup.indexOf(current) / PICKER_PAGE_SIZE) };
}

function filterRow(groups: readonly { id: string; label: string }[], state: PickerState, counts: ReadonlyMap<string, number>) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(pickerCustomId('filter', state))
    .setPlaceholder('Filter voices')
    .addOptions(groups.map((group) => ({
      label: clip(`${group.label} (${counts.get(group.id) ?? 0})`),
      value: group.id,
      default: group.id === state.groupId,
    })));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu).toJSON();
}

function voiceRow(pageEntries: readonly VoiceEntry[], state: PickerState, pages: number, currentValue: string) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(pickerCustomId('pick', state))
    .setPlaceholder(`Choose a voice (page ${state.page + 1} of ${pages})`)
    .addOptions(pageEntries.map((entry) => ({
      label: clip(entry.voice.label),
      description: clip(entry.voice.custom
        ? `Custom voice · ${entry.model.name}`
        : [entry.model.name, entry.voice.description].filter(Boolean).join(' · ')),
      value: entryValue(entry),
      default: entryValue(entry) === currentValue,
    })));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu).toJSON();
}

function pageRow(state: PickerState, pages: number) {
  const previous = new ButtonBuilder()
    .setCustomId(pickerCustomId('prev', state))
    .setLabel('◀ Previous')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(state.page === 0);
  const next = new ButtonBuilder()
    .setCustomId(pickerCustomId('next', state))
    .setLabel('Next ▶')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(state.page >= pages - 1);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(previous, next).toJSON();
}

/**
 * Renders the private /voice picker: current voice, a filter menu, one page
 * of voices and Previous/Next buttons. Out-of-range pages are clamped.
 */
export function renderVoicePicker(
  catalog: ModelCatalog,
  requested: PickerState,
  currentValue: string,
  notice?: string,
  options: VoiceListOptions = {},
): PickerView {
  const entries = voiceEntries(catalog, options);
  const groups = voiceGroups(entries);
  const groupId = groups.some((group) => group.id === requested.groupId) ? requested.groupId : ALL_VOICES.id;
  const inGroup = entriesInGroup(entries, groupId);
  const pages = pageCount(inGroup);
  const state = { groupId, page: Math.min(Math.max(requested.page, 0), pages - 1) };
  const pageEntries = inGroup.slice(state.page * PICKER_PAGE_SIZE, (state.page + 1) * PICKER_PAGE_SIZE);
  const counts = new Map(groups.map((group) => [group.id, entriesInGroup(entries, group.id).length]));
  const current = entries.find((entry) => entryValue(entry) === currentValue);
  const lines = [
    notice,
    `Your voice: **${current ? entryLabel(current) : 'one that is no longer available'}**`,
    `Showing ${groups.find((group) => group.id === groupId)?.label ?? ALL_VOICES.label}, page ${state.page + 1} of ${pages}. Picking a voice switches the model for you.`,
  ];
  return {
    content: lines.filter(Boolean).join('\n'),
    components: [filterRow(groups, state, counts), voiceRow(pageEntries, state, pages, currentValue), pageRow(state, pages)],
  };
}
