export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

export const IDLE: ActionState = {};
