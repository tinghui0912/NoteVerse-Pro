"""Read only explicitly selected JSON metadata; skip all other value spans opaque."""
import json
import re


class Projection:
    def __init__(self, text): self.text=text;self.decoder=json.JSONDecoder();self.skipped=0
    def ws(self,i):
        while i<len(self.text) and self.text[i].isspace(): i+=1
        return i
    def string_end(self,i):
        if self.text[i]!='"': raise ValueError('JSON_STRING_REQUIRED')
        i+=1
        while i<len(self.text):
            if self.text[i]=='\\': i+=2
            elif self.text[i]=='"': return i+1
            else: i+=1
        raise ValueError('JSON_STRING_UNTERMINATED')
    def skip(self,i):
        i=self.ws(i);c=self.text[i]
        if c=='"': return self.string_end(i)
        if c in '{[':
            stack=[c];i+=1
            while stack:
                if i>=len(self.text): raise ValueError('JSON_CONTAINER_UNTERMINATED')
                c=self.text[i]
                if c=='"': i=self.string_end(i);continue
                if c in '{[': stack.append(c)
                elif c in '}]':
                    if stack.pop()!=('{' if c=='}' else '['): raise ValueError('JSON_BRACKET_MISMATCH')
                i+=1
            return i
        match=re.match(r'(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)',self.text[i:])
        if not match: raise ValueError('JSON_SCALAR_INVALID')
        return i+match.end()
    def value(self,i,schema):
        i=self.ws(i)
        if schema is True:
            if self.text[i] in '[{': raise ValueError('METADATA_LEAF_MUST_BE_SCALAR')
            return self.decoder.raw_decode(self.text,i)
        if isinstance(schema,dict):
            if self.text[i]!='{': raise ValueError('METADATA_OBJECT_REQUIRED')
            i=self.ws(i+1);result={}
            if self.text[i]=='}': return result,i+1
            while True:
                key,end=self.decoder.raw_decode(self.text,i)
                if not isinstance(key,str): raise ValueError('JSON_KEY_REQUIRED')
                i=self.ws(end)
                if self.text[i]!=':': raise ValueError('JSON_COLON_REQUIRED')
                i=self.ws(i+1)
                if key in schema: result[key],i=self.value(i,schema[key])
                else: i=self.skip(i);self.skipped+=1
                i=self.ws(i)
                if self.text[i]=='}': return result,i+1
                if self.text[i]!=',': raise ValueError('JSON_COMMA_REQUIRED')
                i=self.ws(i+1)
        if isinstance(schema,list) and len(schema)==1:
            if self.text[i]!='[': raise ValueError('METADATA_ARRAY_REQUIRED')
            i=self.ws(i+1);result=[]
            if self.text[i]==']': return result,i+1
            while True:
                item,i=self.value(i,schema[0]);result.append(item);i=self.ws(i)
                if self.text[i]==']': return result,i+1
                if self.text[i]!=',': raise ValueError('JSON_COMMA_REQUIRED')
                i=self.ws(i+1)
        raise ValueError('INVALID_METADATA_SCHEMA')
    def project(self,schema):
        result,end=self.value(0,schema)
        if self.ws(end)!=len(self.text): raise ValueError('JSON_TRAILING_CONTENT')
        return result
