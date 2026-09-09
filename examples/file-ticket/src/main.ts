import { tickets } from "./ticket-store.js";
import { fileTicket, fileTicketCarefully } from "./tickets.tsi";

const request =
  "After paying, the checkout page went blank and my card was charged twice. Please fix this today.";

const filed = [await fileTicket(request), await fileTicketCarefully(request)];
console.log(JSON.stringify({ filed, tickets }));
