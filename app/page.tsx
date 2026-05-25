import { CustomerDemoClient } from "@/app/demo/customer/customer-demo-client";
import { buildCustomerDemoCopyBundle } from "@/lib/customer-demo";

export default function Home() {
  return <CustomerDemoClient demo={buildCustomerDemoCopyBundle()} />;
}
