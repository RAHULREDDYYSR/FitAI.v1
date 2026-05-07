export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  name?: string;
  photoURL?: string;
  weight?: number;
  height?: number;
  goal?: string;
  aim?: string;
  age?: number;
  sex?: 'male' | 'female' | 'other';
  spreadsheetId?: string;
  customExercises?: ExerciseDefinition[];
  measurements?: {
    weight?: number;
    height?: number;
    bodyFat?: number;
    waist?: number;
  };
  weightHistory?: {
    date: string; // ISO format
    weight: number;
  }[];
  createdAt: any;
}

export interface Set {
  reps: number;
  weight: number;
  completed: boolean;
  timeTaken?: number; // seconds
}

export interface WorkoutExercise {
  exerciseId: string;
  name: string;
  sets: Set[];
}

export interface WorkoutLog {
  id?: string;
  userId: string;
  name: string;
  date: any;
  duration: number;
  totalVolume: number;
  intensity?: number;
  exercises: WorkoutExercise[];
  createdAt: any;
}

export interface Routine {
  id?: string;
  userId: string;
  name: string;
  description: string;
  exercises: WorkoutExercise[];
  createdAt: any;
}

export interface ExerciseDefinition {
  id: string;
  name: string;
  muscle: string;
  muscle_groups: string[];
  category: string;
  equipment: string;
  equipment_list: string[];
  icon?: string;
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'bot' | 'system';
  text: string;
  timestamp: any;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  lastMessage?: string;
  updatedAt: any;
}

export interface ChatSummary {
  userId: string;
  summary: string;
  lastUpdated: any;
}
