/**
 * Service for {{entity}} operations.
 */
export class {{entity}}Service {
  constructor() {
    console.log("{{entity}}Service initialized");
  }

  async find(id: string): Promise<{{entity}} | null> {
    // TODO: Implement find logic
    return null;
  }
}

export interface {{entity}} {
  id: string;
  name: string;
}
