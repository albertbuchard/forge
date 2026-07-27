import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { buildOpenApiDocument } from "./openapi.js";

const issueOperatorSessionCookie = issueTestOperatorSessionCookie;

test("movement repair routes document path and selected-user scope", () => {
  const document = buildOpenApiDocument() as {
    paths: Record<
      string,
      {
        parameters?: Array<{ name?: string }>;
        get?: { parameters?: Array<{ name?: string }> };
        patch?: { parameters?: Array<{ name?: string }> };
        delete?: { parameters?: Array<{ name?: string }> };
      }
    >;
  };

  for (const [path, method] of [
    ["/api/v1/movement/places/{id}", "patch"],
    ["/api/v1/movement/stays/{id}", "patch"],
    ["/api/v1/movement/stays/{id}", "delete"],
    ["/api/v1/movement/trips/{id}", "get"],
    ["/api/v1/movement/trips/{id}", "patch"],
    ["/api/v1/movement/trips/{id}", "delete"],
    ["/api/v1/movement/trips/{id}/points/{pointId}", "patch"],
    ["/api/v1/movement/trips/{id}/points/{pointId}", "delete"]
  ] as const) {
    const pathItem = document.paths[path];
    assert.ok(pathItem, path);
    assert.ok(
      pathItem.parameters?.some((parameter) => parameter.name === "id")
    );
    const operation = pathItem[method];
    assert.ok(operation, `${method.toUpperCase()} ${path}`);
    assert.ok(
      operation.parameters?.some((parameter) => parameter.name === "userIds"),
      `${method.toUpperCase()} ${path} must document userIds`
    );
  }
});

test("movement detail and repair routes enforce the selected user scope", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-movement-scope-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: { cookie: operatorCookie },
      payload: {
        label: "Movement scope test",
        scopes: ["read", "write"],
        scopePolicy: {
          userIds: ["user_forge_bot"],
          projectIds: [],
          tagIds: []
        }
      }
    });
    assert.equal(tokenResponse.statusCode, 201);
    const scopedToken = (
      tokenResponse.json() as { token: { token: string } }
    ).token.token;
    const now = "2026-07-01T12:00:00.000Z";
    const database = getDatabase();
    database
      .prepare(
        `INSERT INTO movement_places (
           id, external_uid, user_id, label, latitude, longitude, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "place_scope_operator",
        "place_scope_operator",
        "user_operator",
        "Operator place",
        46.2,
        6.1,
        now,
        now
      );
    database
      .prepare(
        `INSERT INTO movement_stays (
           id, external_uid, user_id, place_id, label, started_at, ended_at,
           center_latitude, center_longitude, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "stay_scope_operator",
        "stay_scope_operator",
        "user_operator",
        "place_scope_operator",
        "Operator stay",
        "2026-07-01T08:00:00.000Z",
        "2026-07-01T09:00:00.000Z",
        46.2,
        6.1,
        now,
        now
      );
    database
      .prepare(
        `INSERT INTO movement_trips (
           id, external_uid, user_id, start_place_id, end_place_id, label,
           started_at, ended_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "trip_scope_operator",
        "trip_scope_operator",
        "user_operator",
        "place_scope_operator",
        "place_scope_operator",
        "Operator trip",
        "2026-07-01T09:00:00.000Z",
        "2026-07-01T10:00:00.000Z",
        now,
        now
      );
    database
      .prepare(
        `INSERT INTO movement_trip_points (
           id, trip_id, sequence_index, recorded_at, latitude, longitude,
           created_at, external_uid
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "point_scope_operator",
        "trip_scope_operator",
        0,
        "2026-07-01T09:00:00.000Z",
        46.2,
        6.1,
        now,
        "point_scope_operator"
      );
    database
      .prepare(
        `INSERT INTO movement_places (
           id, external_uid, user_id, label, latitude, longitude, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "place_scope_bot",
        "place_scope_bot",
        "user_forge_bot",
        "Bot place",
        46.3,
        6.2,
        now,
        now
      );
    database
      .prepare(
        `INSERT INTO movement_trips (
           id, external_uid, user_id, start_place_id, end_place_id, label,
           started_at, ended_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "trip_scope_bot",
        "trip_scope_bot",
        "user_forge_bot",
        "place_scope_bot",
        "place_scope_bot",
        "Bot trip",
        "2026-07-01T11:00:00.000Z",
        "2026-07-01T12:00:00.000Z",
        now,
        now
      );
    const dayResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/day?date=2026-07-01&userIds=user_operator",
      headers: { cookie: operatorCookie }
    });
    assert.equal(dayResponse.statusCode, 200);
    const day = dayResponse.json() as {
      movement: {
        stays: Array<{ id: string }>;
        trips: Array<{ id: string }>;
      };
    };
    const stayId = day.movement.stays[0]?.id;
    const tripId = day.movement.trips[0]?.id;
    assert.ok(stayId);
    assert.ok(tripId);

    const placesResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/places?userIds=user_operator",
      headers: { cookie: operatorCookie }
    });
    assert.equal(placesResponse.statusCode, 200);
    const placeId = (placesResponse.json() as { places: Array<{ id: string }> })
      .places[0]?.id;
    assert.ok(placeId);

    const tokenScopedDayResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/day?date=2026-07-01&userIds=user_operator",
      headers: { authorization: `Bearer ${scopedToken}` }
    });
    assert.equal(tokenScopedDayResponse.statusCode, 403);

    const tokenScopedWriteResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/movement/places/${placeId}?userIds=user_operator`,
      headers: { authorization: `Bearer ${scopedToken}` },
      payload: { label: "Should not change" }
    });
    assert.equal(tokenScopedWriteResponse.statusCode, 403);

    const tokenScopedDetailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/movement/trips/${tripId}?userIds=user_operator`,
      headers: { authorization: `Bearer ${scopedToken}` }
    });
    assert.equal(tokenScopedDetailResponse.statusCode, 403);

    const unrestrictedBotDetailResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/trips/trip_scope_bot",
      headers: { cookie: operatorCookie }
    });
    assert.equal(unrestrictedBotDetailResponse.statusCode, 200);
    const tokenBotDetailResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/trips/trip_scope_bot",
      headers: { authorization: `Bearer ${scopedToken}` }
    });
    assert.equal(tokenBotDetailResponse.statusCode, 200);
    const wrongSelectedBotDetailResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/trips/trip_scope_bot?userIds=user_operator",
      headers: { cookie: operatorCookie }
    });
    assert.equal(wrongSelectedBotDetailResponse.statusCode, 404);

    const scopedWriteAttempts = [
      {
        method: "PATCH" as const,
        url: `/api/v1/movement/places/${placeId}?userIds=user_forge_bot`,
        payload: { label: "Should not change" }
      },
      {
        method: "PATCH" as const,
        url: `/api/v1/movement/stays/${stayId}?userIds=user_forge_bot`,
        payload: { label: "Should not change" }
      },
      {
        method: "DELETE" as const,
        url: `/api/v1/movement/stays/${stayId}?userIds=user_forge_bot`
      },
      {
        method: "PATCH" as const,
        url: `/api/v1/movement/trips/${tripId}?userIds=user_forge_bot`,
        payload: { label: "Should not change" }
      },
      {
        method: "DELETE" as const,
        url: `/api/v1/movement/trips/${tripId}?userIds=user_forge_bot`
      }
    ];
    for (const attempt of scopedWriteAttempts) {
      const response = await app.inject({
        ...attempt,
        headers: { cookie: operatorCookie }
      });
      assert.equal(
        response.statusCode,
        404,
        `${attempt.method} ${attempt.url}`
      );
    }

    const hiddenTripResponse = await app.inject({
      method: "GET",
      url: `/api/v1/movement/trips/${tripId}?userIds=user_forge_bot`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(hiddenTripResponse.statusCode, 404);

    const ownedTripResponse = await app.inject({
      method: "GET",
      url: `/api/v1/movement/trips/${tripId}?userIds=user_operator`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(ownedTripResponse.statusCode, 200);
    const ownedTrip = ownedTripResponse.json() as {
      movement: { trip: { id: string; points: Array<{ id: string }> } };
    };
    assert.equal(ownedTrip.movement.trip.id, tripId);

    const pointId = ownedTrip.movement.trip.points[0]?.id;
    if (pointId) {
      for (const method of ["PATCH", "DELETE"] as const) {
        const response = await app.inject({
          method,
          url: `/api/v1/movement/trips/${tripId}/points/${pointId}?userIds=user_forge_bot`,
          headers: { cookie: operatorCookie },
          ...(method === "PATCH" ? { payload: { isStopAnchor: true } } : {})
        });
        assert.equal(response.statusCode, 404);
      }
    }

    const retainedTripResponse = await app.inject({
      method: "GET",
      url: `/api/v1/movement/trips/${tripId}?userIds=user_operator`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(retainedTripResponse.statusCode, 200);
    const retainedPlacesResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/places?userIds=user_operator",
      headers: { cookie: operatorCookie }
    });
    assert.ok(
      (
        retainedPlacesResponse.json() as { places: Array<{ id: string }> }
      ).places.some((place) => place.id === placeId)
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
