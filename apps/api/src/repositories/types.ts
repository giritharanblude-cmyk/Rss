export type UserRole = 'master' | 'member';

export type UserRecord = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  passwordHash: string;
  disabled: boolean;
  loginFailures: number;
  lockedUntil: Date | null;
  createdAt: Date;
};

export type NewUser = {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
};

export type UserRepository = {
  findByName(name: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  listMembers(): Promise<UserRecord[]>;
  countMasters(): Promise<number>;
  create(user: NewUser): Promise<UserRecord>;
  setDisabled(id: string, disabled: boolean): Promise<UserRecord | null>;
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
  recordLoginFailure(id: string): Promise<number>;
  resetLoginFailures(id: string): Promise<void>;
  lockUntil(id: string, when: Date): Promise<void>;
};

export type OtpPurpose = 'login' | 'password_change';

export type OtpRecord = {
  id: string;
  userId: string;
  purpose: OtpPurpose;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  usedAt: Date | null;
  createdAt: Date;
};

export type NewOtp = {
  userId: string;
  purpose: OtpPurpose;
  codeHash: string;
  expiresAt: Date;
};

export type OtpRepository = {
  create(otp: NewOtp): Promise<OtpRecord>;
  findLatest(userId: string, purpose: OtpPurpose): Promise<OtpRecord | null>;
  findLatestActive(userId: string, purpose: OtpPurpose, now: Date): Promise<OtpRecord | null>;
  incrementAttempts(id: string, maxAttempts: number): Promise<number>;
  consumeIfActive(id: string, now: Date, maxAttempts: number): Promise<boolean>;
  markUsed(id: string, when: Date): Promise<void>;
  invalidateActive(userId: string, purpose: OtpPurpose, when: Date): Promise<void>;
};
