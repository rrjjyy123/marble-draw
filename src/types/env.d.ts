// Parcel 이 빌드할 때 process.env.NODE_ENV 를 문자열로 바꿔 넣는다.
// 브라우저 코드에 @types/node 를 끌어들이지 않으려고 필요한 만큼만 선언한다
declare const process: { env: { NODE_ENV?: 'development' | 'production' | string } };
