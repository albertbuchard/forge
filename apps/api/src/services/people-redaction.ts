import type { AuthContext } from "../managers/contracts.js";
import type { Person } from "../people-types.js";

function hasScope(auth: AuthContext, scope: string) {
  return Boolean(auth.session || auth.token?.scopes.includes(scope));
}

export function redactPersonForAuth(
  person: Person,
  auth: AuthContext,
  options: { includePrivate: boolean }
): Person {
  const privateAllowed =
    options.includePrivate && hasScope(auth, "people:read:private");
  const contactsAllowed =
    options.includePrivate && hasScope(auth, "people:read:contacts");
  const sensitiveAllowed =
    options.includePrivate && hasScope(auth, "people:read:sensitive");
  const restrictedAllowed =
    options.includePrivate && hasScope(auth, "people:read:restricted");

  return {
    ...person,
    description: privateAllowed ? person.description : "",
    privateNotes: sensitiveAllowed ? person.privateNotes : "",
    howWeMet: privateAllowed ? person.howWeMet : "",
    metAt: privateAllowed ? person.metAt : null,
    birthdayYear: privateAllowed ? person.birthdayYear : null,
    birthdayMonth: privateAllowed ? person.birthdayMonth : null,
    birthdayDay: privateAllowed ? person.birthdayDay : null,
    birthdayPrecision: privateAllowed ? person.birthdayPrecision : "unknown",
    contactPreferences: contactsAllowed ? person.contactPreferences : {},
    metadata: privateAllowed ? person.metadata : {},
    contacts: contactsAllowed ? person.contacts : [],
    facts: person.facts.filter((fact) => {
      if (fact.sensitivity === "basic") {
        return true;
      }
      if (fact.sensitivity === "private") {
        return privateAllowed;
      }
      if (fact.sensitivity === "sensitive") {
        return sensitiveAllowed;
      }
      return restrictedAllowed;
    }),
    actorBindings:
      privateAllowed && Boolean(auth.session) ? person.actorBindings : []
  };
}
