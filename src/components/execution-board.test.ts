import { describe, expect, it } from "vitest";
import { laneFirstCollision } from "./execution-board";

function rect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height
  };
}

function container(id: string) {
  return {
    id,
    data: { current: {} },
    disabled: false,
    rect: { current: null }
  };
}

describe("laneFirstCollision", () => {
  it("resolves to the lane whose surface the dragged card overlaps", () => {
    const collisions = laneFirstCollision({
      active: { id: "task-1" },
      collisionRect: rect(0, 168, 280, 88),
      droppableContainers: [container("lane:focus"), container("lane:in_progress")],
      droppableRects: new Map([
        ["lane:focus", rect(0, 40, 320, 140)],
        ["lane:in_progress", rect(0, 190, 320, 140)]
      ]),
      pointerCoordinates: { x: 140, y: 224 }
    } as never);

    expect(collisions[0]?.id).toBe("lane:in_progress");
  });

  it("prefers the lane over an overlapping task card hit", () => {
    const collisions = laneFirstCollision({
      active: { id: "task-1" },
      collisionRect: rect(0, 190, 280, 88),
      droppableContainers: [container("lane:in_progress"), container("task-2")],
      droppableRects: new Map([
        ["lane:in_progress", rect(0, 190, 320, 140)],
        ["task-2", rect(16, 206, 248, 64)]
      ]),
      pointerCoordinates: { x: 120, y: 230 }
    } as never);

    expect(collisions[0]?.id).toBe("lane:in_progress");
  });

  it("prefers the lane under the pointer even before strong overlap", () => {
    const collisions = laneFirstCollision({
      active: { id: "task-1" },
      collisionRect: rect(0, 150, 280, 88),
      droppableContainers: [container("lane:focus"), container("lane:in_progress")],
      droppableRects: new Map([
        ["lane:focus", rect(0, 40, 320, 140)],
        ["lane:in_progress", rect(0, 220, 320, 180)]
      ]),
      pointerCoordinates: { x: 140, y: 260 }
    } as never);

    expect(collisions[0]?.id).toBe("lane:in_progress");
  });
});
