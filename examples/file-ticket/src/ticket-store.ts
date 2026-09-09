// Plain TypeScript: the function the model calls. Nothing here knows about
// Nola — it is an ordinary async helper with typed parameters.

export interface Ticket {
  id: string;
  title: string;
  /** 1 is most urgent, 5 is lowest */
  priority: number;
}

export const tickets: Ticket[] = [];

export async function createTicket(title: string, priority: number): Promise<string> {
  const id = `T-${tickets.length + 1}`;
  tickets.push({ id, title, priority });
  return id;
}
