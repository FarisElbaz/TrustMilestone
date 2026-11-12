import { fundCase } from "../src/milestone";
import { validatePaymentEnvironment } from "../src/paypal/config";

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const amount = arg("--amount");
const currency = arg("--currency");
async function main(): Promise<void> {
  validatePaymentEnvironment({ requireAmount: true, amount, currency });
  const record = await fundCase(arg("--case"), amount, currency);
  if (record.orderId) {
    console.log(`PayPal order ${record.orderId} status: ${record.orderStatus ?? "recorded"}`);
    console.log(`Approve at: ${record.approvalUrl}`);
    console.log(`Expected sandbox buyer: ${process.env.PAYPAL_BUYER_EMAIL}`);
    console.log("Confirm that this sandbox buyer is the account approving the order.");
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
