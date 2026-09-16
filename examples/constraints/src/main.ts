import { parseSignup, Signup } from "./signup.tsi";

const signup = await parseSignup("Sign up ada_l (ada@example.com), age 36, interested in ts and nola");
const schema = Signup.toJsonSchema() as { properties: Record<string, { format?: string; minimum?: number; type?: string }> };
const bad = Signup.validate({ email: "not-an-email", handle: "A", age: 12.5, tags: [] });
console.log(
  JSON.stringify({
    signup,
    emailFormat: schema.properties.email?.format,
    age: [schema.properties.age?.type, schema.properties.age?.minimum],
    issues: bad.ok ? [] : bad.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  }),
);
