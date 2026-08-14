export function PropertyImage({src,alt,className=""}:{src:string;alt:string;className?:string}){return <img src={src} alt={alt} className={`h-full w-full object-cover ${className}`}/>}
