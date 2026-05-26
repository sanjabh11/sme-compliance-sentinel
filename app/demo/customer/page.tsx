import type { Metadata } from "next";
import { CustomerDemoClient } from "@/app/demo/customer/customer-demo-client";
import { buildCustomerDemoPageBundle } from "@/lib/customer-demo";

export const metadata: Metadata = {
  title: "Customer Demo | SME Workspace Sentinel",
  description: "A guided customer demo for the one-day Google Workspace risk scan and Trust Packet pilot."
};

export default function CustomerDemoPage() {
  return <CustomerDemoClient demo={buildCustomerDemoPageBundle()} />;
}
