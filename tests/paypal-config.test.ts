import { validatePaymentEnvironment } from "../src/paypal/config";

const valid = () => {
  process.env.PAYMENT_MODE = "sandbox";
  process.env.PAYPAL_ENV = "sandbox";
  process.env.PAYPAL_CLIENT_ID = "id";
  process.env.PAYPAL_CLIENT_SECRET = "secret";
  process.env.PAYPAL_BUYER_EMAIL = "buyer@example.test";
  process.env.PAYPAL_CONTRACTOR_EMAIL = "contractor@example.test";
  process.env.PAYPAL_AMOUNT = "10.00";
  process.env.PAYPAL_CURRENCY = "USD";
};

beforeEach(valid);

test.each([
  ["PAYMENT_MODE", "PAYMENT_MODE", "live"],
  ["PAYPAL_ENV", "PAYPAL_ENV", "production"],
  ["client id", "PAYPAL_CLIENT_ID", ""],
  ["client secret", "PAYPAL_CLIENT_SECRET", ""],
  ["buyer email", "PAYPAL_BUYER_EMAIL", ""],
  ["contractor email", "PAYPAL_CONTRACTOR_EMAIL", ""],
  ["amount", "PAYPAL_AMOUNT", "1.001"],
  ["currency", "PAYPAL_CURRENCY", "XYZ"]
])("reports invalid %s", (_label, variable, value) => {
  process.env[variable] = value;
  expect(() => validatePaymentEnvironment()).toThrow("Invalid PayPal configuration");
});

test("reports all invalid fields in one error", () => {
  process.env.PAYPAL_ENV = "live";
  process.env.PAYPAL_CLIENT_ID = "";
  process.env.PAYPAL_AMOUNT = "0";
  expect(() => validatePaymentEnvironment()).toThrow(/PAYPAL_ENV.*PAYPAL_CLIENT_ID.*PAYPAL_AMOUNT/s);
});

test("does not require sandbox variables in mock mode", () => {
  process.env.PAYMENT_MODE = "mock";
  delete process.env.PAYPAL_CLIENT_SECRET;
  expect(() => validatePaymentEnvironment()).not.toThrow();
});
