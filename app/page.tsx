import { CustomerDemoClient } from "@/app/demo/customer/customer-demo-client";
import { buildCustomerDemoPageBundle } from "@/lib/customer-demo";

export default function Home() {
  return <CustomerDemoClient demo={buildCustomerDemoPageBundle()} />;
}
