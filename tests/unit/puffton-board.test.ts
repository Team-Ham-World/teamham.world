import { describe, expect, it } from "vitest";
import {
  buildBoard,
  getEdgeId,
  getHexEdges,
  getHexVertices,
  getTileId,
  getVertexId,
  hexToPixel,
  vertexToPixel,
} from "@/lib/puffton/board";
import type { MapOption } from "@/lib/puffton/types";

describe("puffton board geometry and topology", () => {
  it("computes canonical IDs for tiles, vertices, and edges", () => {
    expect(getTileId(0, 0)).toBe("h:0:0");
    expect(getVertexId(1, -2, "T")).toBe("v:1:-2:T");
    expect(getVertexId(1, -2, "B")).toBe("v:1:-2:B");
    expect(getEdgeId(0, 1, "NE")).toBe("e:0:1:NE");
    expect(getEdgeId(0, 1, "E")).toBe("e:0:1:E");
    expect(getEdgeId(0, 1, "SE")).toBe("e:0:1:SE");
  });

  it("returns 6 canonical vertices and 6 edges for any hex", () => {
    const verts = getHexVertices(0, 0);
    expect(verts).toHaveLength(6);
    expect(verts).toEqual([
      "v:0:0:T",
      "v:1:-1:B",
      "v:0:1:T",
      "v:0:0:B",
      "v:-1:1:T",
      "v:0:-1:B",
    ]);

    const edges = getHexEdges(0, 0);
    expect(edges).toHaveLength(6);
    expect(edges).toEqual([
      "e:0:0:NE",
      "e:0:0:E",
      "e:0:0:SE",
      "e:-1:1:NE",
      "e:-1:0:E",
      "e:0:-1:SE",
    ]);
  });

  it("computes 2D pixel coordinates for hexes and vertices", () => {
    const center = hexToPixel(0, 0, 50);
    expect(center.x).toBe(0);
    expect(center.y).toBe(0);

    const topVertex = vertexToPixel(0, 0, "T", 50);
    expect(topVertex.x).toBe(0);
    expect(topVertex.y).toBe(-50);

    const bottomVertex = vertexToPixel(0, 0, "B", 50);
    expect(bottomVertex.x).toBe(0);
    expect(bottomVertex.y).toBe(50);
  });

  it("builds a classic 19-hex board with complete graph adjacency and ports", () => {
    const board = buildBoard("classic");

    expect(Object.keys(board.tiles)).toHaveLength(19);
    expect(Object.keys(board.vertices).length).toBeGreaterThan(40);
    expect(Object.keys(board.edges).length).toBeGreaterThan(60);

    // Robber tile initialized
    expect(board.robberTileId).toBeTruthy();
    expect(board.tiles[board.robberTileId].terrain).toBe("desert");

    // Every vertex should have adjacent edges and vertices
    for (const vertex of Object.values(board.vertices)) {
      expect(vertex.adjacentVertices.length).toBeGreaterThanOrEqual(2);
      expect(vertex.adjacentVertices.length).toBeLessThanOrEqual(3);
      expect(vertex.adjacentEdges.length).toBeGreaterThanOrEqual(2);
      expect(vertex.adjacentEdges.length).toBeLessThanOrEqual(3);
    }

    // Check port presence
    const verticesWithPorts = Object.values(board.vertices).filter((v) => !!v.port);
    expect(verticesWithPorts.length).toBeGreaterThanOrEqual(10);
  });

  it("builds all supported map variations correctly", () => {
    const mapTypes: MapOption[] = ["classic", "expanded", "archipelago", "duel", "random"];

    for (const map of mapTypes) {
      const board = buildBoard(map);
      expect(Object.keys(board.tiles).length).toBeGreaterThanOrEqual(12);
      expect(Object.keys(board.vertices).length).toBeGreaterThan(20);
      expect(board.robberTileId).toBeTruthy();
    }
  });
});
