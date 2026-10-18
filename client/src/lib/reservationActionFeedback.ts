export function reservationActionFeedback(status?: string, reason?: string): { title: string; description: string } {
  const currentStatus = status || "updated";
  const title = currentStatus === "payment_check" ? "Payment check required"
    : currentStatus === "confirmed" ? "Reservation confirmed"
    : currentStatus === "cancelled" ? "Reservation cancelled"
    : `Reservation ${currentStatus.replaceAll("_", " ")}`;
  const description = reason || (currentStatus === "payment_check"
    ? "The appointment remains held until the payment has been checked."
    : currentStatus === "confirmed"
      ? "The booking is confirmed; the appointment has not been released."
      : currentStatus === "cancelled"
        ? "The cancellation is complete and the appointment has been released."
        : "The reservation status has been refreshed.");
  return { title, description };
}
