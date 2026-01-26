/**
 * {{Entity}} Repository
 *
 * Data access layer for {{entity}} entities.
 */
export interface {{Entity}}Repository {
  findById(id: string): Promise<{{Entity}} | null>;
  save(entity: {{Entity}}): Promise<void>;
}
