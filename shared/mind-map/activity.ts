import type { MindMapCommand } from './schema';

export type MindMapChangeSummary = {
  added: number;
  updated: number;
  moved: number;
  deleted: number;
  relations: number;
  groups: number;
  replaced: boolean;
  changedNodeIds: string[];
};

export function summarizeMindMapCommands(
  commands: readonly MindMapCommand[],
): MindMapChangeSummary {
  const summary: MindMapChangeSummary = {
    added: 0,
    updated: 0,
    moved: 0,
    deleted: 0,
    relations: 0,
    groups: 0,
    replaced: false,
    changedNodeIds: [],
  };
  const changedNodeIds = new Set<string>();

  for (const command of commands) {
    if (command.type === 'replaceDocument') {
      summary.replaced = true;
      changedNodeIds.add(command.document.root.id);
    } else if (command.type === 'addNode') {
      summary.added += 1;
      changedNodeIds.add(command.node.id);
    } else if (command.type === 'updateNode') {
      summary.updated += 1;
      changedNodeIds.add(command.nodeId);
    } else if (command.type === 'moveNode') {
      summary.moved += 1;
      changedNodeIds.add(command.nodeId);
    } else if (command.type === 'deleteNode') {
      summary.deleted += 1;
    } else if (command.type === 'upsertRelation' || command.type === 'deleteRelation') {
      summary.relations += 1;
    } else if (command.type === 'upsertGroup' || command.type === 'deleteGroup') {
      summary.groups += 1;
    }
  }

  summary.changedNodeIds = [...changedNodeIds];
  return summary;
}
