import { mount } from "svelte";
import LiveDataApp from "./LiveDataApp.svelte";

const app = mount(LiveDataApp, {
	target: document.getElementById("app")!,
});

export default app;
