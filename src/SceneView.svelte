<script>

  export let isStudioMode;
  export let transitionScene;
  export let nextSlide;
  export let previousSlide;
  export let isLiturgieMode;
  export let previewClass;

</script>
{#if isLiturgieMode}
  <div class="columns is-centered is-vcentered has-text-centered">
    <div class="column">
      <button class="button is-primary" on:click={previousSlide}>Vorige Vers</button>
    </div>
    <div class="column">
      <button class="button is-primary" on:click={nextSlide}>Volgende Vers</button>
    </div>
  </div>
{/if}
<div class="columns is-centered is-vcentered has-text-centered mt-1">
  {#if isStudioMode}
    <div class="column">
      <img id="preview" class="is-hidden has-background-dark" alt="Preview" />
    </div>
    <div class="column is-narrow">
      <button on:click={transitionScene} class="button is-fullwidth is-info">Transition</button>
    </div>
  {/if}
  <div class="{isStudioMode ? 'column' : previewClass }">
    <img id="program" alt="Program" class="is-hidden"/>
  </div>
</div>


