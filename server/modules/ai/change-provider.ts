import type { MindMapChangeRequest, MindMapChangeSet } from '../../../shared/mind-map';

export interface MindMapChangeProvider {
  proposeChangeSet(request: MindMapChangeRequest, signal?: AbortSignal): Promise<MindMapChangeSet>;
}
