import { paymentStatus } from "../src/milestone";
import { validatePaymentEnvironment } from "../src/paypal/config";

const index = process.argv.indexOf("--case");
const caseId = process.argv[index + 1];
if (!caseId) throw new Error("Missing --case");
async function main(): Promise<void> {
  validatePaymentEnvironment();
  const record = await paymentStatus(caseId);
  console.log(`Order ${record.orderId ?? "mock"} status: ${record.orderStatus ?? "AUTHORIZED"}`);
  if (record.authorizationId) {
    console.log(`Authorization: ${record.authorizationId}`);
    console.log(`Authorization status: ${record.authorizationStatus ?? "unknown"}`);
    console.log(`Authorization expires: ${record.authorizationExpirationTime ?? "unknown"}`);
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
