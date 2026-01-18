const MIKE_AVATAR = "https://lh3.googleusercontent.com/aida-public/AB6AXuCxQqaGItOZji-_GVFAVOolS45cDQxKKSssHrCqioVn_2Qm-xDjmvNbqA9y7ejL7va2QHALxWHdjHcFAKDiDw82DfBVls1Sc9W6kHryrr4t9IaqWSg_-5XLyQdtfweMBsCpVa0VnBviI0vbKNT0VnRJBGuRvT5VukTUr0m6qPsqUWmyWD6S3Du9ySKvhVD-ZK5-yVryLM6f48OT4x-DmX_W7aEObmxVcuOLKWab5PSiJLeu-p6l_U8vjtARZxuIsgzkoE4Ndhtzpt4p"
const USER_AVATAR = "https://lh3.googleusercontent.com/aida-public/AB6AXuDzU5cVLxp-CdWiTH6hq3Dji55D1wB-zrriZdNm0SkG8eSBAy8Kk8higAnEmndE7viNy3jpZPRO0_dse7ssGoRLeDbif1YXW3nCo23aDCYC4QkdJV9wi1fyHfPFtaVYXS9lsL5CrcOEEQIhxAWoucZNxIUiEvpEX9COG88uHH9vYhBMla87Pt3oWkaCWo7SJwq6fLS2-mulY5_z0EiahlaJnmymbL5sg-KzXbbAUfMqArAsyvQ61Yn46RFYaRBvHBu4pD1-j650AATW"

export default function Message({ message }) {
  const isUser = message.role === 'user'
  const avatar = isUser ? USER_AVATAR : MIKE_AVATAR
  const name = isUser ? 'You' : 'Mike'

  return (
    <div className={`flex items-end gap-3 group ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <div 
          className="bg-center bg-no-repeat bg-cover rounded-full w-9 h-9 shrink-0 shadow-lg ring-2 ring-white/5"
          style={{ backgroundImage: `url("${avatar}")` }}
        />
      )}
      
      <div className={`flex flex-col gap-1 max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`flex items-center gap-2 px-1 ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="text-white/50 text-xs font-medium">{name}</span>
          <span className="text-white/20 text-[10px]">{message.timestamp}</span>
        </div>
        
        <div className={`p-4 text-white/90 shadow-md leading-relaxed ${
          isUser 
            ? 'rounded-2xl rounded-tr-sm bg-primary shadow-lg shadow-primary/20' 
            : 'rounded-2xl rounded-tl-sm bg-[#233648]/80 backdrop-blur-sm border border-white/5'
        }`}>
          <p>{message.content}</p>
        </div>
      </div>
      
      {isUser && (
        <div 
          className="bg-center bg-no-repeat bg-cover rounded-full w-9 h-9 shrink-0 ring-2 ring-white/5"
          style={{ backgroundImage: `url("${avatar}")` }}
        />
      )}
    </div>
  )
}
