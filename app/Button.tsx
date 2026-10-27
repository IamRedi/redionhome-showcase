import type {ButtonHTMLAttributes} from 'react';

/** Neutral action surface shared by editor, update and assistant entry points. */
export function Button({className='',type='button',...props}:ButtonHTMLAttributes<HTMLButtonElement>){
  return <button type={type} className={`glass-button ${className}`} {...props}/>;
}
