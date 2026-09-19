import { describe, it, expect } from "vitest";
import { HilbrasChatService, type ChatOptions } from "../src/frameworks/angular/chat.service.js";
import { HilbrasCompletionService } from "../src/frameworks/angular/completion.service.js";
import { HilbrasObjectService } from "../src/frameworks/angular/object.service.js";

describe("HilbrasChatService", () => {
  it("starts with empty state", () => {
    const svc = new HilbrasChatService();
    expect(svc.messages()).toEqual([]);
    expect(svc.input()).toBe("");
    expect(svc.isLoading()).toBe(false);
    expect(svc.error()).toBeNull();
    expect(svc.hasMessages()).toBe(false);
  });

  it("setInput updates input signal", () => {
    const svc = new HilbrasChatService();
    svc.setInput("hello");
    expect(svc.input()).toBe("hello");
  });

  it("clear resets all state", () => {
    const svc = new HilbrasChatService();
    svc.setInput("test");
    svc.clear();
    expect(svc.input()).toBe("");
    expect(svc.messages()).toEqual([]);
    expect(svc.error()).toBeNull();
  });

  it("stop aborts controller and resets loading", () => {
    const svc = new HilbrasChatService();
    svc.stop();
    expect(svc.isLoading()).toBe(false);
  });
});

describe("HilbrasCompletionService", () => {
  it("starts with empty state", () => {
    const svc = new HilbrasCompletionService();
    expect(svc.text()).toBe("");
    expect(svc.isLoading()).toBe(false);
    expect(svc.error()).toBeNull();
  });

  it("clear resets state", () => {
    const svc = new HilbrasCompletionService();
    svc.clear();
    expect(svc.text()).toBe("");
    expect(svc.error()).toBeNull();
  });

  it("stop resets loading", () => {
    const svc = new HilbrasCompletionService();
    svc.stop();
    expect(svc.isLoading()).toBe(false);
  });
});

describe("HilbrasObjectService", () => {
  it("starts with empty state", () => {
    const svc = new HilbrasObjectService();
    expect(svc.object()).toBeNull();
    expect(svc.isLoading()).toBe(false);
    expect(svc.error()).toBeNull();
  });

  it("clear resets state", () => {
    const svc = new HilbrasObjectService();
    svc.clear();
    expect(svc.object()).toBeNull();
    expect(svc.error()).toBeNull();
  });
});
