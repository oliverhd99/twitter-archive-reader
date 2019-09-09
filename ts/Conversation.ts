import { GDPRConversation, DirectMessage, LinkedDirectMessage } from "./TwitterTypes";

/** Register the number of messages in each year, month and day, and let you access those messages. */
interface ConversationIndex {
  count: number,
  years: {
    [year: string]: {
      count: number,
      months: {
        [months: string]: {
          count: number,
          days: {
            [day: string]: {
              count: number,
              messages: LinkedDirectMessage[]
            }
          }
        }
      }
    }
  }
};

interface DirectMessageIndex {
  [id: string]: LinkedDirectMessage
}

interface DirectMessageDateIndex {
  [year: string]: {
    [month: string]: {
      [day: string]: DirectMessageIndex
    }
  }
}

interface ConversationInfo {
  participants: Set<string>;
  me: string;
}

interface FullConversationInfo extends ConversationInfo {
  id: string;
}

abstract class ConversationBase {
  /** Handle infomations of this conversation like owner and participants. */
  protected info: ConversationInfo;

  protected _index: DirectMessageIndex = {};
  protected index_by_date: DirectMessageDateIndex = {};

  protected register(msg: LinkedDirectMessage) {
    this._index[msg.id] = msg;

    if (!msg.createdAtDate) {
      msg.createdAtDate = new Date(msg.createdAt);
    }

    const [day, month, year] = [
      msg.createdAtDate.getDate(), 
      msg.createdAtDate.getMonth() + 1, 
      msg.createdAtDate.getFullYear()
    ];

    if (!this.index_by_date[year]) {
      this.index_by_date[year] = {};
    }

    if (!this.index_by_date[year][month]) {
      this.index_by_date[year][month] = {};
    }

    if (!this.index_by_date[year][month][day]) {
      this.index_by_date[year][month][day] = {};
    }

    this.index_by_date[year][month][day][msg.id] = msg;
  }

  protected unregisterAll() {
    this._index = {},
    this.index_by_date = {};
  }

  /** Get direct messages from a specific month. */
  month(month: string, year: string) : SubConversation {
    if (year in this.index_by_date && month in this.index_by_date[year]) {
      const messages = [].concat(...Object.values(this.index_by_date[year][month]));
      
      return new SubConversation(messages, this.info.me);
    }

    return new SubConversation([], this.info.me);
  }

  /** Find direct messages that matches a query on their text. */
  find(query: RegExp) {
    return new SubConversation(this.all.filter(e => query.test(e.text)), this.info.me);
  }

  /** Find context around a single direct message. */
  around(id: string, context: number = 20) {
    if (id in this._index) {
      const before: LinkedDirectMessage[] = [];
      const after: LinkedDirectMessage[] = [];
      const current = this._index[id];

      // Récupération des msg le précédant
      let current_observed_msg = current.previous;
      for (let i = 0; i < context && current_observed_msg !== null; i++) {
        before.push(current_observed_msg);
        current_observed_msg = current_observed_msg.previous;
        i++;
      }

      // Flip in order to have the older messages being on top.
      before.reverse();

      // Récupération des messages le suivant
      current_observed_msg = current.next;
      for (let i = 0; i < context && current_observed_msg !== null; i++) {
        after.push(current_observed_msg);
        current_observed_msg = current_observed_msg.next;
        i++;
      }

      return {
        before,
        current,
        after
      };
    }

    return undefined;
  }

  /** Get all messages sended by a specific user (by ID) */
  sender(id: string): SubConversation;
  /** Get all messages sended by a pool of users (by ID) */
  sender(ids: Set<string>): SubConversation;
  sender(ids: string | Set<string> | string[]) {
    if (typeof ids === 'string') {
      ids = new Set([ids]);
    }
    if (Array.isArray(ids)) {
      ids = new Set(ids);
    }

    return new SubConversation(this.all.filter(m => (ids as Set<string>).has(m.senderId)), this.info.me);
  }

  /** Get all messages received by a specific user (by ID) */
  recipient(id: string): SubConversation;
  /** Get all messages received by a pool of users (by ID) */
  recipient(ids: Set<string> | string[]): SubConversation;
  recipient(ids: string | Set<string> | string[]) {
    if (typeof ids === 'string') {
      ids = new Set([ids]);
    }
    if (Array.isArray(ids)) {
      ids = new Set(ids);
    }

    return new SubConversation(this.all.filter(m => (ids as Set<string>).has(m.recipientId)), this.info.me);
  }

  /** Get all the direct messages between two dates. */
  between(since: Date, until: Date): SubConversation;
  /** Get all the direct messages between two specific messages (ids). */
  between(since_id: string, until_id: string): SubConversation;
  between(since: Date | string, until: Date | string) {
    if (typeof since === 'string' && typeof until === 'string') {
      return this.betweenIds(since, until);
    }
    if (since instanceof Date && until instanceof Date) {
      until.setDate(until.getDate() + 1);
  
      const since_time = since.getTime();
      const until_time = until.getTime();
  
      const valids: LinkedDirectMessage[] = [];
  
      for (const dm of this) {
        if (dm.createdAtDate.getTime() >= since_time && dm.createdAtDate.getTime() <= until_time) {
          valids.push(dm);
        }
      }
  
      return new SubConversation(valids, this.info.me);
    }

    throw new Error("since and until must both be strings, or both be Date objects.");
  }

  protected betweenIds(id1: string, id2: string) {
    if (BigInt(id1) > BigInt(id2)) {
      const tmp = id2;
      id2 = id1;
      id1 = tmp;
    }

    let current = this.single(id1);
    const return_value: LinkedDirectMessage[] = [];

    while (current !== null && current.id !== id2) {
      return_value.push(current);
      current = current.next;
    }

    return new SubConversation(return_value, this.info.me);
  }

  /** Retreives a single message (undefined if message does not exists). */
  single(id: string) {
    return this._index[id];
  }

  /** Iterates all over the direct messages stored in this conversation. */
  *[Symbol.iterator]() {
    yield* this.all;
  }

  /** Participants IDs */
  get participants() : Set<string> {
    return this.info.participants;
  }

  /** 
   * Participants IDs, but without yourself. 
   * If <return_value>.size > 1, conversation is a group conversation 
   */
  get real_participants() : Set<string> {
    const tmp = new Set(this.info.participants);
    tmp.delete(this.info.me);

    return tmp;
  }

  /** True if this conversation is a group conversation. */
  get is_group_conversation() {
    return this.info.participants.size > 2;
  }

  /** All the messages in this conversation */
  get all() : LinkedDirectMessage[] {
    return Object.values(this._index);
  }

  /** Count of total messages, messages per year, month, day, plus the messages themselves. */
  get index() : ConversationIndex {
    // Total count
    const info: ConversationIndex = {
      count: 0,
      years: {}
    };

    // Count for each year separatly
    for (const [year, y_msgs] of Object.entries(this.index_by_date)) {
      info.years[year] = {
        count: 0,
        months: {}
      };

      // Count for each month separatly
      for (const [month, m_msgs] of Object.entries(y_msgs)) {
        info.years[year].months[month] = {
          count: 0,
          days: {}
        };

        // Count for each day separatly
        for (const [day, d_msgs] of Object.entries(m_msgs)) {
          const m = Object.values(d_msgs);
          info.years[year].months[month].days[day] = {
            count: m.length,
            messages: m
          };

          // Mise à jour compteurs intermédiaires
          info.count += m.length;
          info.years[year].count += m.length;
          info.years[year].months[month].count += m.length;
        }
      }
    }

    return info;
  }

  /** Messages sorted by year, month and day, without any other informations */
  get raw_index() : DirectMessageDateIndex {
    return this.index_by_date;
  }

  /** Number of messages in this conversation */
  get length() {
    return this.all.length;
  }
}

/**
 * Conversation between the owner of archive and one or more participants.
 */
export class Conversation extends ConversationBase {
  protected info: FullConversationInfo;
  protected unindexed: DirectMessage[] = [];

  /** 
   * Create a new Conversation instance, from raw GDPR conversation. 
   * Need self user_id to recognize which user is you.
   * 
   * Note that **.add()** is automatically call with the given conversation.
   */
  constructor(conv: GDPRConversation, me_id: string) {
    super();

    this.info = { id: conv.dmConversation.conversationId, me: me_id, participants: new Set };

    this.add(conv);
  }

  /** 
   * Add a new conversation part to actual conversation. 
   * Actual conversation and new part must have the same ID.
   * 
   * After you've imported all parts, you **must** call **.indexate()** to see messages !
   */
  add(conv: GDPRConversation) {
    // TODO optimize
    if (conv.dmConversation.conversationId !== this.info.id) {
      throw new Error("You must add into a existing conversation a conversation with the same ID");
    }
    
    this.unindexed.push(
      ...conv.dmConversation.messages
        .map(e => e.welcomeMessageCreate ? e.welcomeMessageCreate : e.messageCreate)
        .filter(e => e) // Supprime les possibles undefined (clé messageXXX non connue)
    );
  }

  /** 
   * Index imported messages. 
   * Needed to see all DMs. 
   * 
   * Should be call after you've imported all with **.add()**.
   */
  indexate() {
    const participants = new Set<string>();

    // Récupération des messages et tri par le plus vieux (ID le plus bas)
    const msgs: DirectMessage[] | LinkedDirectMessage[] = this.unindexed
        .concat(this.all) // Ajoute le set de messages actuel (réindexe tout)
        .sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)));

    this.unindexed = [];

    this.unregisterAll();

    // Indexation (ajout d'une clé next et previous)
    let previous_message: LinkedDirectMessage | null = null;

    for (const actual_msg of msgs) {
      const swallow = actual_msg as LinkedDirectMessage;

      swallow.previous = previous_message;
      swallow.next = null;
      swallow.createdAtDate = new Date(swallow.createdAt);

      if (previous_message) {
        previous_message.next = swallow;
      }

      previous_message = swallow;

      // Enregistrement participants
      if (swallow.recipientId !== "0")
        participants.add(swallow.recipientId);

      participants.add(swallow.senderId);

      // Enregistrement dans l'index
      this.register(swallow);
    }

    // Enregistrement infos
    this.info.participants = participants;
  }

  /** Conversation ID */
  get id() : string {
    return this.info.id;
  }
}

/** Part of a real conversation that have its own index and message count. */
export class SubConversation extends ConversationBase {
  constructor(messages: LinkedDirectMessage[], me_id: string) {
    super();

    const participants = new Set<string>();

    for (const actual_msg of messages) {
      // Enregistrement participants
      if (actual_msg.recipientId !== "0")
        participants.add(actual_msg.recipientId);

      participants.add(actual_msg.senderId);

      // Enregistrement dans l'index
      this.register(actual_msg);
    }

    // Enregistrement infos
    this.info = {
      participants,
      me: me_id
    };
  }
}

export default Conversation;
