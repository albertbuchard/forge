import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

import type { RouteRegistration } from "./route-contract.js";

const FASTIFY_METHODS = new Set([
  "all",
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put"
]);

export type UnresolvedRouteRegistration = {
  sourceFile: string;
  sourceLine: number;
  method: string;
  expression: string;
};

export type SourceRouteInventory = {
  routes: RouteRegistration[];
  unresolved: UnresolvedRouteRegistration[];
  sourceFiles: string[];
};

const EXPLICIT_DYNAMIC_ROUTE_FAMILIES: Array<{
  sourceFile: string;
  unresolvedExpressions: ReadonlySet<string>;
  routes: Array<{ method: string; routePath: string }>;
}> = [
  {
    sourceFile: "app.ts",
    unresolvedExpressions: new Set([
      "catalogPath",
      "basePath",
      "`${basePath}/:id`",
      "`${basePath}/:id/run`",
      "`${basePath}/:id/chat`",
      "`${basePath}/:id/output`",
      "`${basePath}/:id/runs`",
      "`${basePath}/:id/runs/:runId`",
      "`${basePath}/:id/runs/:runId/cancel`",
      "`${basePath}/:id/runs/:runId/nodes`",
      "`${basePath}/:id/runs/:runId/nodes/:nodeId`",
      "`${basePath}/:id/nodes/:nodeId/output`"
    ]),
    routes: [
      { method: "GET", routePath: "/api/v1/workbench/catalog/boxes" },
      { method: "GET", routePath: "/api/v1/workbench/flows" },
      { method: "POST", routePath: "/api/v1/workbench/flows" },
      { method: "GET", routePath: "/api/v1/workbench/flows/:id" },
      { method: "PATCH", routePath: "/api/v1/workbench/flows/:id" },
      { method: "DELETE", routePath: "/api/v1/workbench/flows/:id" },
      { method: "POST", routePath: "/api/v1/workbench/flows/:id/run" },
      { method: "POST", routePath: "/api/v1/workbench/flows/:id/chat" },
      { method: "GET", routePath: "/api/v1/workbench/flows/:id/output" },
      { method: "GET", routePath: "/api/v1/workbench/flows/:id/runs" },
      {
        method: "GET",
        routePath: "/api/v1/workbench/flows/:id/runs/:runId"
      },
      {
        method: "POST",
        routePath: "/api/v1/workbench/flows/:id/runs/:runId/cancel"
      },
      {
        method: "GET",
        routePath: "/api/v1/workbench/flows/:id/runs/:runId/nodes"
      },
      {
        method: "GET",
        routePath: "/api/v1/workbench/flows/:id/runs/:runId/nodes/:nodeId"
      },
      {
        method: "GET",
        routePath: "/api/v1/workbench/flows/:id/nodes/:nodeId/output"
      }
    ]
  },
  {
    sourceFile: "routes/peer-sharing.ts",
    unresolvedExpressions: new Set(["path"]),
    routes: [
      {
        method: "POST",
        routePath:
          "/api/v1/peers/relationships/:relationshipId/devices/:deviceId/approve"
      },
      {
        method: "POST",
        routePath:
          "/api/v1/peers/relationships/:relationshipId/devices/:deviceId/remove"
      }
    ]
  }
];

async function listTypeScriptFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === "course-catalog" ||
      entry.name === "security"
    ) {
      continue;
    }
    const absolute = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTypeScriptFiles(absolute)));
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(absolute);
    }
  }
  return files;
}

function collectStringConstants(sourceFile: ts.SourceFile) {
  const constants = new Map<string, string>();
  const declarations: Array<{ name: string; initializer: ts.Expression }> = [];

  function collect(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      declarations.push({
        name: node.name.text,
        initializer: node.initializer
      });
    }
    ts.forEachChild(node, collect);
  }
  collect(sourceFile);

  function resolve(expression: ts.Expression): string | null {
    if (ts.isStringLiteralLike(expression)) {
      return expression.text;
    }
    if (ts.isParenthesizedExpression(expression)) {
      return resolve(expression.expression);
    }
    if (ts.isIdentifier(expression)) {
      return constants.get(expression.text) ?? null;
    }
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = resolve(expression.left);
      const right = resolve(expression.right);
      return left === null || right === null ? null : `${left}${right}`;
    }
    if (ts.isTemplateExpression(expression)) {
      let value = expression.head.text;
      for (const span of expression.templateSpans) {
        const resolved = resolve(span.expression);
        if (resolved === null) {
          return null;
        }
        value += resolved + span.literal.text;
      }
      return value;
    }
    return null;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (constants.has(declaration.name)) {
        continue;
      }
      const value = resolve(declaration.initializer);
      if (value !== null) {
        constants.set(declaration.name, value);
        changed = true;
      }
    }
  }
  return { constants, resolve };
}

function lineNumber(sourceFile: ts.SourceFile, node: ts.Node) {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function receiverLooksLikeServer(expression: ts.Expression) {
  if (ts.isIdentifier(expression)) {
    return /^(app|server|fastify)$/i.test(expression.text);
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return receiverLooksLikeServer(expression.expression);
  }
  return false;
}

function methodValues(expression: ts.Expression): string[] | null {
  if (ts.isStringLiteralLike(expression)) {
    return [expression.text.toUpperCase()];
  }
  if (ts.isArrayLiteralExpression(expression)) {
    const values = expression.elements.flatMap((entry) =>
      ts.isStringLiteralLike(entry) ? [entry.text.toUpperCase()] : []
    );
    return values.length === expression.elements.length ? values : null;
  }
  return null;
}

function numericValue(expression: ts.Expression): number | null {
  if (ts.isNumericLiteral(expression)) {
    return Number(expression.text);
  }
  if (ts.isParenthesizedExpression(expression)) {
    return numericValue(expression.expression);
  }
  if (ts.isBinaryExpression(expression)) {
    const left = numericValue(expression.left);
    const right = numericValue(expression.right);
    if (left === null || right === null) {
      return null;
    }
    switch (expression.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken:
        return left + right;
      case ts.SyntaxKind.MinusToken:
        return left - right;
      case ts.SyntaxKind.AsteriskToken:
        return left * right;
      case ts.SyntaxKind.SlashToken:
        return left / right;
      default:
        return null;
    }
  }
  return null;
}

function bodyLimitFromOptions(expression: ts.Expression | undefined) {
  if (!expression || !ts.isObjectLiteralExpression(expression)) {
    return undefined;
  }
  const property = expression.properties.find(
    (entry): entry is ts.PropertyAssignment =>
      ts.isPropertyAssignment(entry) &&
      ((ts.isIdentifier(entry.name) && entry.name.text === "bodyLimit") ||
        (ts.isStringLiteralLike(entry.name) && entry.name.text === "bodyLimit"))
  );
  if (!property) {
    return undefined;
  }
  return numericValue(property.initializer) ?? undefined;
}

export async function discoverSourceRouteInventory(
  apiSourceRoot: string
): Promise<SourceRouteInventory> {
  const sourceFiles = await listTypeScriptFiles(apiSourceRoot);
  const routes: RouteRegistration[] = [];
  const unresolved: UnresolvedRouteRegistration[] = [];

  for (const absoluteFile of sourceFiles) {
    const sourceText = await readFile(absoluteFile, "utf8");
    const sourceFile = ts.createSourceFile(
      absoluteFile,
      sourceText,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS
    );
    const relativeFile = path.relative(apiSourceRoot, absoluteFile);
    const { resolve } = collectStringConstants(sourceFile);

    function addRoute(
      method: string,
      routePath: string,
      node: ts.Node,
      explicitBodyLimit?: number
    ) {
      if (!routePath.startsWith("/")) {
        return;
      }
      routes.push({
        method: method.toUpperCase(),
        routePath,
        sourceFile: relativeFile,
        sourceLine: lineNumber(sourceFile, node),
        ...(explicitBodyLimit === undefined ? {} : { explicitBodyLimit })
      });
    }

    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const methodName = node.expression.name.text.toLowerCase();
        const receiver = node.expression.expression;
        if (
          FASTIFY_METHODS.has(methodName) &&
          receiverLooksLikeServer(receiver)
        ) {
          const routeExpression = node.arguments[0];
          const routePath = routeExpression ? resolve(routeExpression) : null;
          if (routePath) {
            const explicitBodyLimit = bodyLimitFromOptions(node.arguments[1]);
            const methods =
              methodName === "all"
                ? ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
                : [methodName.toUpperCase()];
            for (const method of methods) {
              addRoute(method, routePath, node, explicitBodyLimit);
            }
          } else {
            unresolved.push({
              sourceFile: relativeFile,
              sourceLine: lineNumber(sourceFile, node),
              method: methodName.toUpperCase(),
              expression: routeExpression?.getText(sourceFile) ?? "<missing>"
            });
          }
        }

        if (
          methodName === "route" &&
          receiverLooksLikeServer(receiver) &&
          node.arguments[0] &&
          ts.isObjectLiteralExpression(node.arguments[0])
        ) {
          const routeOptions = node.arguments[0];
          const urlProperty = routeOptions.properties.find(
            (property): property is ts.PropertyAssignment =>
              ts.isPropertyAssignment(property) &&
              ts.isIdentifier(property.name) &&
              (property.name.text === "url" || property.name.text === "path")
          );
          const methodProperty = routeOptions.properties.find(
            (property): property is ts.PropertyAssignment =>
              ts.isPropertyAssignment(property) &&
              ts.isIdentifier(property.name) &&
              property.name.text === "method"
          );
          const routePath = urlProperty
            ? resolve(urlProperty.initializer)
            : null;
          const methods = methodProperty
            ? methodValues(methodProperty.initializer)
            : null;
          const explicitBodyLimit = bodyLimitFromOptions(routeOptions);
          if (routePath && methods) {
            for (const method of methods) {
              addRoute(method, routePath, node, explicitBodyLimit);
            }
          } else {
            unresolved.push({
              sourceFile: relativeFile,
              sourceLine: lineNumber(sourceFile, node),
              method: "ROUTE",
              expression: routeOptions.getText(sourceFile)
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  for (const family of EXPLICIT_DYNAMIC_ROUTE_FAMILIES) {
    const matchingUnresolved = unresolved.filter(
      (entry) =>
        entry.sourceFile === family.sourceFile &&
        family.unresolvedExpressions.has(entry.expression)
    );
    if (matchingUnresolved.length === 0) {
      continue;
    }
    for (const route of family.routes) {
      routes.push({
        ...route,
        sourceFile: family.sourceFile,
        sourceLine: matchingUnresolved[0]?.sourceLine
      });
    }
  }

  const unresolvedAfterExpansion = unresolved.filter((entry) => {
    const family = EXPLICIT_DYNAMIC_ROUTE_FAMILIES.find(
      (candidate) => candidate.sourceFile === entry.sourceFile
    );
    return !family?.unresolvedExpressions.has(entry.expression);
  });

  routes.sort((left, right) => {
    const keyCompare = `${left.method} ${left.routePath}`.localeCompare(
      `${right.method} ${right.routePath}`
    );
    return (
      keyCompare ||
      (left.sourceFile ?? "").localeCompare(right.sourceFile ?? "") ||
      (left.sourceLine ?? 0) - (right.sourceLine ?? 0)
    );
  });
  unresolvedAfterExpansion.sort((left, right) =>
    `${left.sourceFile}:${left.sourceLine}`.localeCompare(
      `${right.sourceFile}:${right.sourceLine}`
    )
  );

  return {
    routes,
    unresolved: unresolvedAfterExpansion,
    sourceFiles: sourceFiles
      .map((entry) => path.relative(apiSourceRoot, entry))
      .sort()
  };
}
