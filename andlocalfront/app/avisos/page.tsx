import type { Metadata } from "next";
import NotificationSettings from "../features/notifications/notification-settings";

export const metadata: Metadata = { title: "Avisos | AND Local Ads" };

export default function NotificationSettingsPage() {
  return <NotificationSettings />;
}
