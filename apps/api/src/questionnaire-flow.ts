import { HttpError } from "./errors.js";
import type { QuestionnaireDefinition } from "./questionnaire-types.js";

type Primitive = number | string | boolean | null;

type FlowToken =
  | { type: "identifier"; value: string }
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "null" }
  | {
      type:
        | "("
        | ")"
        | ","
        | "=="
        | "!="
        | ">"
        | ">="
        | "<"
        | "<="
        | "+"
        | "-"
        | "*"
        | "/"
        | "&&"
        | "||"
        | "!";
    };

type FlowExpression =
  | { kind: "literal"; value: Primitive }
  | { kind: "reference"; itemId: string }
  | { kind: "unary"; operator: "!" | "-"; operand: FlowExpression }
  | {
      kind: "binary";
      operator:
        | "=="
        | "!="
        | ">"
        | ">="
        | "<"
        | "<="
        | "+"
        | "-"
        | "*"
        | "/"
        | "&&"
        | "||";
      left: FlowExpression;
      right: FlowExpression;
    }
  | {
      kind: "call";
      name: "answered" | "option" | "label" | "value";
      args: FlowExpression[];
    };

type ComparisonOperator = "==" | "!=" | ">" | ">=" | "<" | "<=";

type QuestionnaireAnswerState = {
  itemId?: string;
  item_id?: string;
  optionKey?: string | null;
  option_key?: string | null;
  numericValue?: number | null;
  numeric_value?: number | null;
  valueText?: string | null;
  value_text?: string | null;
};

const PARSE_CACHE = new Map<string, FlowExpression>();

function createQuestionnaireFlowError(message: string) {
  return new HttpError(400, "questionnaire_flow_invalid", message);
}

function tokenize(script: string): FlowToken[] {
  const tokens: FlowToken[] = [];
  let index = 0;

  while (index < script.length) {
    const current = script[index]!;
    if (/\s/.test(current)) {
      index += 1;
      continue;
    }

    const pair = script.slice(index, index + 2);
    if (
      pair === "==" ||
      pair === "!=" ||
      pair === ">=" ||
      pair === "<=" ||
      pair === "&&" ||
      pair === "||"
    ) {
      tokens.push({ type: pair });
      index += 2;
      continue;
    }

    if ("(),><+-*/!".includes(current)) {
      tokens.push({
        type: current as "(" | ")" | "," | ">" | "<" | "+" | "-" | "*" | "/" | "!"
      });
      index += 1;
      continue;
    }

    if (current === "'" || current === '"') {
      const quote = current;
      index += 1;
      let value = "";
      while (index < script.length && script[index] !== quote) {
        const char = script[index]!;
        if (char === "\\" && index + 1 < script.length) {
          value += script[index + 1]!;
          index += 2;
          continue;
        }
        value += char;
        index += 1;
      }
      if (script[index] !== quote) {
        throw createQuestionnaireFlowError(
          `Unterminated string in flow rule: ${script}`
        );
      }
      index += 1;
      tokens.push({ type: "string", value });
      continue;
    }

    if (/\d/.test(current)) {
      let value = current;
      index += 1;
      while (index < script.length && /[\d.]/.test(script[index]!)) {
        value += script[index]!;
        index += 1;
      }
      tokens.push({ type: "number", value: Number(value) });
      continue;
    }

    if (/[A-Za-z_]/.test(current)) {
      let value = current;
      index += 1;
      while (index < script.length && /[A-Za-z0-9_]/.test(script[index]!)) {
        value += script[index]!;
        index += 1;
      }
      const normalized = value.toLowerCase();
      if (normalized === "and") {
        tokens.push({ type: "&&" });
      } else if (normalized === "or") {
        tokens.push({ type: "||" });
      } else if (normalized === "not") {
        tokens.push({ type: "!" });
      } else if (normalized === "true") {
        tokens.push({ type: "boolean", value: true });
      } else if (normalized === "false") {
        tokens.push({ type: "boolean", value: false });
      } else if (normalized === "null") {
        tokens.push({ type: "null" });
      } else {
        tokens.push({ type: "identifier", value });
      }
      continue;
    }

    throw createQuestionnaireFlowError(
      `Unexpected token '${current}' in flow rule: ${script}`
    );
  }

  return tokens;
}

function parseExpression(tokens: FlowToken[], script: string) {
  let index = 0;

  function peek() {
    return tokens[index];
  }

  function consume<TType extends FlowToken["type"]>(type?: TType) {
    const token = tokens[index];
    if (!token) {
      return null;
    }
    if (type && token.type !== type) {
      return null;
    }
    index += 1;
    return token as Extract<FlowToken, { type: TType }>;
  }

  function expect<TType extends FlowToken["type"]>(type: TType) {
    const token = consume(type);
    if (!token) {
      throw createQuestionnaireFlowError(
        `Expected '${type}' in flow rule: ${script}`
      );
    }
    return token;
  }

  function parsePrimary(): FlowExpression {
    const token = peek();
    if (!token) {
      throw createQuestionnaireFlowError(
        `Unexpected end of flow rule: ${script}`
      );
    }

    if (consume("(")) {
      const expression = parseOr();
      expect(")");
      return expression;
    }

    if (token.type === "number") {
      consume("number");
      return { kind: "literal", value: token.value };
    }

    if (token.type === "string") {
      consume("string");
      return { kind: "literal", value: token.value };
    }

    if (token.type === "boolean") {
      consume("boolean");
      return { kind: "literal", value: token.value };
    }

    if (token.type === "null") {
      consume("null");
      return { kind: "literal", value: null };
    }

    if (token.type === "identifier") {
      const identifier = consume("identifier")!.value;
      if (consume("(")) {
        const args: FlowExpression[] = [];
        if (!consume(")")) {
          do {
            args.push(parseOr());
          } while (consume(","));
          expect(")");
        }
        if (
          identifier !== "answered" &&
          identifier !== "option" &&
          identifier !== "label" &&
          identifier !== "value"
        ) {
          throw createQuestionnaireFlowError(
            `Unknown flow function '${identifier}' in rule: ${script}`
          );
        }
        return { kind: "call", name: identifier, args };
      }
      return { kind: "reference", itemId: identifier };
    }

    throw createQuestionnaireFlowError(
      `Unexpected token '${token.type}' in flow rule: ${script}`
    );
  }

  function parseUnary(): FlowExpression {
    if (consume("!")) {
      return { kind: "unary", operator: "!", operand: parseUnary() };
    }
    if (consume("-")) {
      return { kind: "unary", operator: "-", operand: parseUnary() };
    }
    return parsePrimary();
  }

  function parseMultiplicative(): FlowExpression {
    let expression = parseUnary();
    while (true) {
      if (consume("*")) {
        expression = {
          kind: "binary",
          operator: "*",
          left: expression,
          right: parseUnary()
        };
        continue;
      }
      if (consume("/")) {
        expression = {
          kind: "binary",
          operator: "/",
          left: expression,
          right: parseUnary()
        };
        continue;
      }
      return expression;
    }
  }

  function parseAdditive(): FlowExpression {
    let expression = parseMultiplicative();
    while (true) {
      if (consume("+")) {
        expression = {
          kind: "binary",
          operator: "+",
          left: expression,
          right: parseMultiplicative()
        };
        continue;
      }
      if (consume("-")) {
        expression = {
          kind: "binary",
          operator: "-",
          left: expression,
          right: parseMultiplicative()
        };
        continue;
      }
      return expression;
    }
  }

  function parseComparison(): FlowExpression {
    let expression = parseAdditive();
    while (true) {
      const token = peek();
      const operator =
        token &&
        (
          token.type === "==" ||
          token.type === "!=" ||
          token.type === ">=" ||
          token.type === "<=" ||
          token.type === ">" ||
          token.type === "<"
        )
          ? (token.type as ComparisonOperator)
          : null;
      if (!operator) {
        return expression;
      }
      index += 1;
      expression = {
        kind: "binary",
        operator,
        left: expression,
        right: parseAdditive()
      };
    }
  }

  function parseAnd(): FlowExpression {
    let expression = parseComparison();
    while (consume("&&")) {
      expression = {
        kind: "binary",
        operator: "&&",
        left: expression,
        right: parseComparison()
      };
    }
    return expression;
  }

  function parseOr(): FlowExpression {
    let expression = parseAnd();
    while (consume("||")) {
      expression = {
        kind: "binary",
        operator: "||",
        left: expression,
        right: parseAnd()
      };
    }
    return expression;
  }

  const expression = parseOr();
  if (index < tokens.length) {
    throw createQuestionnaireFlowError(
      `Unexpected trailing tokens in flow rule: ${script}`
    );
  }
  return expression;
}

function parseScript(script: string) {
  const cached = PARSE_CACHE.get(script);
  if (cached) {
    return cached;
  }
  const parsed = parseExpression(tokenize(script), script);
  PARSE_CACHE.set(script, parsed);
  return parsed;
}

function resolveReference(
  expression: FlowExpression
): string | null {
  if (expression.kind === "reference") {
    return expression.itemId;
  }
  if (
    expression.kind === "literal" &&
    typeof expression.value === "string" &&
    expression.value.trim().length > 0
  ) {
    return expression.value.trim();
  }
  return null;
}

function collectReferences(expression: FlowExpression): string[] {
  switch (expression.kind) {
    case "reference":
      return [expression.itemId];
    case "literal":
      return [];
    case "unary":
      return collectReferences(expression.operand);
    case "binary":
      return [
        ...collectReferences(expression.left),
        ...collectReferences(expression.right)
      ];
    case "call": {
      const direct = expression.args[0] ? resolveReference(expression.args[0]) : null;
      return [
        ...(direct ? [direct] : []),
        ...expression.args.flatMap((arg) => collectReferences(arg))
      ];
    }
    default:
      return [];
  }
}

function toBoolean(value: Primitive) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return value.length > 0;
  }
  return false;
}

function toNumber(value: Primitive) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function compareValues(
  left: Primitive,
  operator: "==" | "!=" | ">" | ">=" | "<" | "<=",
  right: Primitive
) {
  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    switch (operator) {
      case "==":
        return leftNumber === rightNumber;
      case "!=":
        return leftNumber !== rightNumber;
      case ">":
        return leftNumber > rightNumber;
      case ">=":
        return leftNumber >= rightNumber;
      case "<":
        return leftNumber < rightNumber;
      case "<=":
        return leftNumber <= rightNumber;
    }
  }
  if (operator === "==" || operator === "!=") {
    return operator === "==" ? left === right : left !== right;
  }
  return false;
}

function evaluateExpression(
  expression: FlowExpression,
  context: {
    getAnswerValue: (itemId: string) => Primitive;
    getOptionKey: (itemId: string) => string | null;
    getLabel: (itemId: string) => string | null;
    isAnswered: (itemId: string) => boolean;
  }
): Primitive {
  switch (expression.kind) {
    case "literal":
      return expression.value;
    case "reference":
      return context.getAnswerValue(expression.itemId);
    case "unary": {
      const value = evaluateExpression(expression.operand, context);
      if (expression.operator === "!") {
        return !toBoolean(value);
      }
      const number = toNumber(value);
      return number === null ? null : -number;
    }
    case "binary": {
      const left = evaluateExpression(expression.left, context);
      const right = evaluateExpression(expression.right, context);
      switch (expression.operator) {
        case "&&":
          return toBoolean(left) && toBoolean(right);
        case "||":
          return toBoolean(left) || toBoolean(right);
        case "+":
          return left === null || right === null
            ? null
            : (toNumber(left) ?? 0) + (toNumber(right) ?? 0);
        case "-":
          return left === null || right === null
            ? null
            : (toNumber(left) ?? 0) - (toNumber(right) ?? 0);
        case "*":
          return left === null || right === null
            ? null
            : (toNumber(left) ?? 0) * (toNumber(right) ?? 0);
        case "/": {
          const divisor = toNumber(right);
          if (left === null || divisor === null || divisor === 0) {
            return null;
          }
          return (toNumber(left) ?? 0) / divisor;
        }
        default:
          return compareValues(
            left,
            expression.operator,
            right
          );
      }
    }
    case "call": {
      const reference = expression.args[0]
        ? resolveReference(expression.args[0])
        : null;
      if (!reference) {
        return null;
      }
      switch (expression.name) {
        case "answered":
          return context.isAnswered(reference);
        case "option":
          return context.getOptionKey(reference);
        case "label":
          return context.getLabel(reference);
        case "value":
          return context.getAnswerValue(reference);
      }
    }
  }
}

function buildAnswerMap(answers: QuestionnaireAnswerState[]) {
  return new Map(
    answers
      .map((answer) => {
        const itemId = answer.itemId ?? answer.item_id;
        if (!itemId) {
          return null;
        }
        return [
          itemId,
          {
            optionKey: answer.optionKey ?? answer.option_key ?? null,
            numericValue: answer.numericValue ?? answer.numeric_value ?? null,
            valueText: answer.valueText ?? answer.value_text ?? null
          }
        ] as const;
      })
      .filter(
        (
          entry
        ): entry is readonly [
          string,
          {
            optionKey: string | null;
            numericValue: number | null;
            valueText: string | null;
          }
        ] => entry !== null
      )
  );
}

export function evaluateFlowRuleScript(
  script: string,
  answers: QuestionnaireAnswerState[],
  visibleItemIds: Set<string>
) {
  const expression = parseScript(script);
  const answerMap = buildAnswerMap(answers);
  const result = evaluateExpression(expression, {
    getAnswerValue: (itemId) => {
      if (!visibleItemIds.has(itemId)) {
        return null;
      }
      const answer = answerMap.get(itemId);
      return answer?.numericValue ?? answer?.optionKey ?? answer?.valueText ?? null;
    },
    getOptionKey: (itemId) =>
      visibleItemIds.has(itemId) ? answerMap.get(itemId)?.optionKey ?? null : null,
    getLabel: (itemId) =>
      visibleItemIds.has(itemId) ? answerMap.get(itemId)?.valueText ?? null : null,
    isAnswered: (itemId) => {
      if (!visibleItemIds.has(itemId)) {
        return false;
      }
      const answer = answerMap.get(itemId);
      return Boolean(
        answer &&
          (answer.optionKey !== null ||
            answer.numericValue !== null ||
            (answer.valueText ?? "").trim().length > 0)
      );
    }
  });
  return toBoolean(result);
}

export function getQuestionnaireVisibilityState(
  definition: QuestionnaireDefinition,
  answers: QuestionnaireAnswerState[]
) {
  const visibleItemIds = new Set<string>();
  const visibleSectionIds = new Set<string>();
  const itemById = new Map(definition.items.map((item) => [item.id, item] as const));

  for (const section of definition.sections) {
    const sectionVisible =
      !section.visibility ||
      evaluateFlowRuleScript(section.visibility.script, answers, visibleItemIds);
    if (!sectionVisible) {
      continue;
    }
    const visibleItemsInSection = section.itemIds.filter((itemId) => {
      const item = itemById.get(itemId);
      if (!item) {
        return false;
      }
      const itemVisible =
        !item.visibility ||
        evaluateFlowRuleScript(item.visibility.script, answers, visibleItemIds);
      if (itemVisible) {
        visibleItemIds.add(item.id);
      }
      return itemVisible;
    });
    if (visibleItemsInSection.length > 0) {
      visibleSectionIds.add(section.id);
    }
  }

  return {
    visibleItemIds,
    visibleSectionIds
  };
}

export function validateQuestionnaireFlow(definition: QuestionnaireDefinition) {
  const knownItemIds = new Set(definition.items.map((item) => item.id));
  const itemOrder = new Map(
    definition.itemIds.map((itemId, index) => [itemId, index] as const)
  );

  for (const section of definition.sections) {
    for (const itemId of section.itemIds) {
      if (!knownItemIds.has(itemId)) {
        throw createQuestionnaireFlowError(
          `Questionnaire section '${section.id}' references unknown item '${itemId}'.`
        );
      }
    }
    if (section.visibility) {
      const refs = Array.from(
        new Set(collectReferences(parseScript(section.visibility.script)))
      );
      const firstSectionItemIndex = Math.min(
        ...section.itemIds.map((itemId) => itemOrder.get(itemId) ?? Number.MAX_SAFE_INTEGER)
      );
      for (const ref of refs) {
        if (!knownItemIds.has(ref)) {
          throw createQuestionnaireFlowError(
            `Section '${section.id}' flow rule references unknown item '${ref}'.`
          );
        }
        if ((itemOrder.get(ref) ?? -1) >= firstSectionItemIndex) {
          throw createQuestionnaireFlowError(
            `Section '${section.id}' flow rule must only depend on earlier items.`
          );
        }
      }
    }
  }

  for (const item of definition.items) {
    if (!item.visibility) {
      continue;
    }
    const refs = Array.from(
      new Set(collectReferences(parseScript(item.visibility.script)))
    );
    const itemIndex = itemOrder.get(item.id) ?? Number.MAX_SAFE_INTEGER;
    for (const ref of refs) {
      if (!knownItemIds.has(ref)) {
        throw createQuestionnaireFlowError(
          `Item '${item.id}' flow rule references unknown item '${ref}'.`
        );
      }
      if ((itemOrder.get(ref) ?? -1) >= itemIndex) {
        throw createQuestionnaireFlowError(
          `Item '${item.id}' flow rule must only depend on earlier items.`
        );
      }
    }
  }
}
