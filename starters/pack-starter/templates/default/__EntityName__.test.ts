import { describe, it, expect, beforeEach } from "vitest";
import { {{entityName}}Service } from "./{{entityName}}";

describe("{{entityName}}Service", () => {
  let service: {{entityName}}Service;

  beforeEach(() => {
    service = new {{entityName}}Service();
  });

  it("creates a new {{entityName}}", () => {
    const item = service.create("test-id");
    expect(item.id).toBe("test-id");
    expect(item.createdAt).toBeDefined();
  });

  it("finds by id", () => {
    service.create("find-me");
    const found = service.findById("find-me");
    expect(found).toBeDefined();
    expect(found?.id).toBe("find-me");
  });

  it("returns undefined for non-existent id", () => {
    expect(service.findById("missing")).toBeUndefined();
  });

  it("lists all items", () => {
    service.create("a");
    service.create("b");
    const all = service.findAll();
    expect(all).toHaveLength(2);
  });

  it("deletes an item", () => {
    service.create("delete-me");
    expect(service.delete("delete-me")).toBe(true);
    expect(service.findById("delete-me")).toBeUndefined();
  });
});
