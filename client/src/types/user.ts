// UniPass 登入後在前端流通的使用者資料
export type AppUser = {
  id: number | string;
  studentId?: string | null;
  email?: string | null;
  name: string;
  role: string;
  picture?: string;
  authType?: string;
  gender?: string | null;
  birthday?: string | null;
  phone?: string | null;
  hasPassword?: boolean;
};
