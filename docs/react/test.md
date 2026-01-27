```jsx live
function Demo() {
  const count = useSignal(0);
  return <button onClick={() => {
    count.v += 1;
    console.log(count.v);
  }}>{count.c}</button>;
}
```
