import {describe,it,expect} from 'vitest';
import {assessNumbersInText,parseNumberToken} from './numbers.js';
const unexpected=(text:string,source:string)=>assessNumbersInText(text,source).filter(a=>a.disposition==='unexpected');
describe('exact number presentation equivalents',()=>{
 it.each([['2 kroner','NOK 2.00'],['2,00 kroner','NOK 2'],['2,50 kroner','NOK 2.5'],['0,144 prosent','0.144 per cent'],['0,144 prosent','0.144 per\ncent'],['0,1440 prosent','0.144%']])('accepts %s from %s',(text,source)=>expect(unexpected(text,source)).toEqual([]));
 it.each([['20 kroner','NOK 2.00'],['2 kroner','NOK 2.01'],['-2 kroner','NOK 2.00'],['0,144 prosent','0.144 shares'],['0,144 kroner','0.144 per cent'],['144 prosent','0.144 per cent']])('rejects changed value/sign/unit: %s from %s',(text,source)=>expect(unexpected(text,source)).not.toEqual([]));
 it('retains source precision for rounding rules',()=>expect(parseNumberToken('2.00')?.key).toBe('+|2.00|abs|2'));
});
