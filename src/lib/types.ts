export type LeadStatus = 'new' | 'contacted' | 'quoted' | 'active' | 'declined';
export type ServiceType = 'weekly' | 'one-time' | 'turf' | 'yard-deep-clean';
export type YardSize = 'small' | 'medium' | 'large';
export type Frequency = 'weekly' | 'biweekly';

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  service_type: ServiceType | string;
  yard_size: YardSize | string;
  num_dogs: number;
  frequency: Frequency | string;
  notes: string;
  source_page: string;
  status: LeadStatus;
  created_at: string;
  updated_at: string;
}

export type MessageStatus = 'unread' | 'read' | 'replied';

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  status: MessageStatus;
  created_at: string;
}

export type Database = {
  public: {
    Tables: {
      leads: {
        Row: Lead;
        Insert: Omit<Lead, 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<Lead, 'id' | 'created_at'>>;
      };
      contact_messages: {
        Row: ContactMessage;
        Insert: Omit<ContactMessage, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<ContactMessage, 'id' | 'created_at'>>;
      };
    };
  };
};
