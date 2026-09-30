// Plain TypeScript: the function the model calls. Nothing here knows about
// Nola — it is an ordinary async helper with typed parameters.

export interface Ticket {
  id: string;
  title: string;
  /** 1 is most urgent, 5 is lowest */
  priority: number;
}

const tickets: Ticket[] = [];

export async function createTicket(title: string, priority: number): Promise<Ticket> {
  const ticket = { id: `T-${tickets.length + 1}`, title, priority };
  tickets.push(ticket);
  return ticket;
}
